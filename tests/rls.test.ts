// Integration tests for row-level security. Requires a migrated database
// (see README) and the NUXT_DATABASE_URL / NUXT_AUTH_DATABASE_URL in .env.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })

/** Run queries as `userId` the same way server/utils/db.ts does. */
function as<T>(userId: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    if (userId) await sql`select set_config('app.user_id', ${userId}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  return u as { id: string, email: string }
}

let alice: { id: string, email: string }
let bob: { id: string, email: string }
let carol: { id: string, email: string }
let boardId: string
let columnId: string
let cardId: string

beforeAll(async () => {
  ;[alice, bob, carol] = await Promise.all([createUser('alice'), createUser('bob'), createUser('carol')])
  await as(alice.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Alice board')` as any
    ;[{ id: columnId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: cardId }] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'Card', 1, ${alice.id}) returning id` as any
  })
})

afterAll(async () => {
  await as(alice.id, sql => sql`delete from boards where id = ${boardId}`)
  await Promise.all([app.end(), auth.end()])
})

describe('rls', () => {
  it('creator is owner', async () => {
    const [m] = await as(alice.id, sql => sql`select role from board_members where board_id = ${boardId} and user_id = ${alice.id}`)
    expect(m?.role).toBe('owner')
  })

  it('no identity sees nothing', async () => {
    expect(await as(null, sql => sql`select id from boards`)).toHaveLength(0)
    expect(await as(null, sql => sql`select id from users`)).toHaveLength(0)
  })

  it('non-member cannot see or change the board', async () => {
    await as(bob.id, async (sql) => {
      expect(await sql`select id from boards where id = ${boardId}`).toHaveLength(0)
      expect(await sql`select id from columns where board_id = ${boardId}`).toHaveLength(0)
      expect(await sql`select id from cards where board_id = ${boardId}`).toHaveLength(0)
      expect(await sql`select user_id from board_members where board_id = ${boardId}`).toHaveLength(0)
      expect((await sql`update boards set name = 'pwned' where id = ${boardId}`).count).toBe(0)
      expect((await sql`delete from cards where id = ${cardId}`).count).toBe(0)
      // cannot read alice's user row either
      expect(await sql`select id from users where id = ${alice.id}`).toHaveLength(0)
    })
    await rejectsWith(as(bob.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'x', 2, ${bob.id})`), '42501')
    await rejectsWith(as(bob.id, sql => sql`insert into board_members (board_id, user_id, role) values (${boardId}, ${bob.id}, 'owner')`), '42501')
    await rejectsWith(as(bob.id, sql => sql`select app.add_board_member(${boardId}, ${bob.email}, 'owner')`), '42501')
  })

  it('direct board insert is blocked', async () => {
    await rejectsWith(as(bob.id, sql => sql`insert into boards (name, owner_id) values ('x', ${bob.id})`), '42501')
  })

  it('password_hash is never readable by the app role', async () => {
    await rejectsWith(as(alice.id, sql => sql`select password_hash from users where id = ${alice.id}`), '42501')
  })

  it('viewer can read but not write', async () => {
    await as(alice.id, sql => sql`select app.add_board_member(${boardId}, ${bob.email}, 'viewer')`)
    await as(bob.id, async (sql) => {
      expect(await sql`select id from boards where id = ${boardId}`).toHaveLength(1)
      expect(await sql`select id from cards where board_id = ${boardId}`).toHaveLength(1)
      expect(await sql`select id from users where id = ${alice.id}`).toHaveLength(1)
      expect((await sql`update cards set title = 'x' where id = ${cardId}`).count).toBe(0)
    })
    await rejectsWith(as(bob.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'x', 2, ${bob.id})`), '42501')
  })

  it('editor can write cards but not manage members or the board', async () => {
    await as(alice.id, sql => sql`update board_members set role = 'editor' where board_id = ${boardId} and user_id = ${bob.id}`)
    await as(bob.id, async (sql) => {
      await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'bob card', 2, ${bob.id})`
      expect((await sql`update cards set title = 'edited' where id = ${cardId}`).count).toBe(1)
      expect((await sql`update boards set name = 'x' where id = ${boardId}`).count).toBe(0)
      expect((await sql`delete from boards where id = ${boardId}`).count).toBe(0)
      expect((await sql`update board_members set role = 'owner' where board_id = ${boardId} and user_id = ${bob.id}`).count).toBe(0)
    })
    await rejectsWith(as(bob.id, sql => sql`select app.add_board_member(${boardId}, ${carol.email}, 'viewer')`), '42501')
    // cannot spoof created_by
    await rejectsWith(as(bob.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'x', 3, ${alice.id})`), '42501')
    // cannot assign a non-member
    await rejectsWith(as(bob.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${cardId}, ${carol.id}, ${boardId})`), '42501')
  })

  it('cards cannot move into another board\'s column', async () => {
    const otherCol = await as(bob.id, async (sql) => {
      const [b] = await sql`select id from app.create_board('Bob board')`
      const [c] = await sql`insert into columns (board_id, title, position) values (${b!.id}, 'x', 1) returning id`
      return c!.id as string
    })
    await rejectsWith(as(bob.id, sql => sql`update cards set column_id = ${otherCol} where id = ${cardId}`), '23503')
  })

  it('column colour must be lowercase #rrggbb or null', async () => {
    const [c] = await as(alice.id, sql => sql`update columns set color = '#1a2b3c' where id = ${columnId} returning color`)
    expect(c?.color).toBe('#1a2b3c')
    await rejectsWith(as(alice.id, sql => sql`update columns set color = 'red' where id = ${columnId}`), '23514')
    await rejectsWith(as(alice.id, sql => sql`update columns set color = '#1A2B3C' where id = ${columnId}`), '23514')
    await as(alice.id, sql => sql`update columns set color = null where id = ${columnId}`)
  })

  it('last owner cannot leave or be demoted', async () => {
    await rejectsWith(as(alice.id, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${alice.id}`), '23514')
    await rejectsWith(as(alice.id, sql => sql`update board_members set role = 'viewer' where board_id = ${boardId} and user_id = ${alice.id}`), '23514')
  })

  it('member can leave, and then loses access', async () => {
    await as(bob.id, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${bob.id}`)
    expect(await as(bob.id, sql => sql`select id from boards where id = ${boardId}`)).toHaveLength(0)
  })

  it('owner can delete the board (cascade passes last-owner guard)', async () => {
    const id = await as(carol.id, async (sql) => {
      const [b] = await sql`select id from app.create_board('Carol board')`
      return b!.id as string
    })
    expect((await as(carol.id, sql => sql`delete from boards where id = ${id}`)).count).toBe(1)
  })
})
