// Starred boards (board_stars) and board archive (boards.archived_at) under RLS.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
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

type User = { id: string, email: string }
let alice: User, bob: User, carol: User, dave: User
let boardId: string, columnId: string, cardId: string, tagId: string
let teamId: string, teamBoardId: string

beforeAll(async () => {
  ;[alice, bob, carol, dave] = await Promise.all([createUser('alice'), createUser('bob'), createUser('carol'), createUser('dave')])
  await as(alice.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Archive board')` as any
    ;[{ id: columnId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: cardId }] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'Card', 1, ${alice.id}) returning id` as any
    ;[{ id: tagId }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'Bug', '#ff0000') returning id` as any
    await sql`insert into card_comments (card_id, board_id, author_id, body) values (${cardId}, ${boardId}, ${alice.id}, 'hi')`
    await sql`select app.add_board_member(${boardId}, ${bob.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${carol.email}, 'viewer')`
    ;[{ id: teamId }] = await sql`select id from app.create_team('Archivers')` as any
    await sql`select app.add_team_member(${teamId}, ${dave.email}, 'owner')`
    ;[{ id: teamBoardId }] = await sql`select id from app.create_board('Team board', ${teamId})` as any
  })
})

afterAll(async () => {
  await as(alice.id, async (sql) => {
    await sql`delete from boards where id = ${boardId}`
    await sql`delete from teams where id = ${teamId}`
  })
  await Promise.all([app.end(), auth.end()])
})

describe('board stars', () => {
  it('members star and unstar boards for themselves only', async () => {
    await as(carol.id, sql => sql`insert into board_stars (user_id, board_id) values (${carol.id}, ${boardId})`)
    await rejectsWith(as(carol.id, sql => sql`insert into board_stars (user_id, board_id) values (${alice.id}, ${boardId})`), '42501')
    expect(await as(carol.id, sql => sql`select board_id from board_stars`)).toEqual([{ board_id: boardId }])
    // Others never see someone else's stars, nor delete them.
    expect(await as(alice.id, sql => sql`select 1 from board_stars where user_id = ${carol.id}`)).toHaveLength(0)
    expect((await as(alice.id, sql => sql`delete from board_stars where user_id = ${carol.id}`)).count).toBe(0)
    expect((await as(carol.id, sql => sql`delete from board_stars where board_id = ${boardId}`)).count).toBe(1)
  })

  it('cannot star a board without access, and stars hide once access is lost', async () => {
    await rejectsWith(as(dave.id, sql => sql`insert into board_stars (user_id, board_id) values (${dave.id}, ${boardId})`), '42501')
    await as(alice.id, sql => sql`select app.add_board_member(${boardId}, ${dave.email}, 'viewer')`)
    await as(dave.id, sql => sql`insert into board_stars (user_id, board_id) values (${dave.id}, ${boardId})`)
    await as(alice.id, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${dave.id}`)
    expect(await as(dave.id, sql => sql`select 1 from board_stars where board_id = ${boardId}`)).toHaveLength(0)
  })
})

describe('board archive', () => {
  it('only owners archive and unarchive', async () => {
    await rejectsWith(as(bob.id, sql => sql`select app.set_board_archived(${boardId}, true)`), '42501')
    await rejectsWith(as(carol.id, sql => sql`select app.set_board_archived(${boardId}, true)`), '42501')
    await rejectsWith(as(dave.id, sql => sql`select app.set_board_archived(${boardId}, true)`), '42501')
    // No direct UPDATE of archived_at, owners included.
    await rejectsWith(as(alice.id, sql => sql`update boards set archived_at = now() where id = ${boardId}`), '42501')
    // A team owner owns the team's boards.
    const [b] = await as(dave.id, sql => sql`select archived_at from app.set_board_archived(${teamBoardId}, true)`)
    expect(b!.archived_at).toBeInstanceOf(Date)
    await as(dave.id, sql => sql`select app.set_board_archived(${teamBoardId}, false)`)
  })

  it('archived boards are read-only for everyone, owners included', async () => {
    const [{ archived_at: first }] = await as(alice.id, sql => sql`select archived_at from app.set_board_archived(${boardId}, true)`) as any
    // Archiving again keeps the original time.
    const [{ archived_at: again }] = await as(alice.id, sql => sql`select archived_at from app.set_board_archived(${boardId}, true)`) as any
    expect(again).toEqual(first)

    for (const u of [alice, bob]) {
      await as(u.id, async (sql) => {
        expect(await sql`select id from cards where id = ${cardId}`).toHaveLength(1)
        expect((await sql`update cards set title = 'x' where id = ${cardId}`).count).toBe(0)
        expect((await sql`delete from cards where id = ${cardId}`).count).toBe(0)
        expect((await sql`update columns set title = 'x' where id = ${columnId}`).count).toBe(0)
        expect((await sql`delete from tags where id = ${tagId}`).count).toBe(0)
        expect((await sql`delete from card_comments where card_id = ${cardId}`).count).toBe(0)
        expect((await sql`update boards set name = 'x' where id = ${boardId}`).count).toBe(0)
      })
      await rejectsWith(as(u.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'x', 2, ${u.id})`), '42501')
      await rejectsWith(as(u.id, sql => sql`insert into columns (board_id, title, position) values (${boardId}, 'x', 2)`), '42501')
      await rejectsWith(as(u.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${cardId}, ${boardId}, ${u.id}, 'x')`), '42501')
      await rejectsWith(as(u.id, sql => sql`insert into card_tags (card_id, tag_id, board_id) values (${cardId}, ${tagId}, ${boardId})`), '42501')
    }
    // Stars stay personal and possible.
    await as(carol.id, sql => sql`insert into board_stars (user_id, board_id) values (${carol.id}, ${boardId})`)
  })

  it('unarchiving makes the board writable again', async () => {
    await rejectsWith(as(bob.id, sql => sql`select app.set_board_archived(${boardId}, false)`), '42501')
    const [b] = await as(alice.id, sql => sql`select archived_at from app.set_board_archived(${boardId}, false)`)
    expect(b!.archived_at).toBeNull()
    expect((await as(bob.id, sql => sql`update cards set title = 'back' where id = ${cardId}`)).count).toBe(1)
  })

  it('owners can still delete an archived board', async () => {
    const id = await as(alice.id, async (sql) => {
      const [b] = await sql`select id from app.create_board('Doomed')`
      await sql`select app.set_board_archived(${b!.id}, true)`
      return b!.id as string
    })
    expect((await as(alice.id, sql => sql`delete from boards where id = ${id}`)).count).toBe(1)
  })
})
