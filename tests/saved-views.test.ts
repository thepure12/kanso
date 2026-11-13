// RLS for saved views: personal rows (own user only) and shared rows (editors manage).
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const owner_ = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>, tokenBoards?: string[]) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    if (tokenBoards) await sql`select set_config('app.token_boards', ${`{${tokenBoards.join(',')}}`}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

type User = { id: string, email: string }
const created: string[] = []
async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  created.push(u!.id)
  return u as User
}

let owner: User, editor: User, viewer: User, outsider: User
let boardId: string, otherBoardId: string

const config = { view: 'list', groupBy: 'none', columnGroupId: null, filter: { text: '', tagIds: [], assigneeIds: [], priorities: [], due: 'any', fields: {} } }

/** Inserts a view as `by`: personal unless shared. */
const newView = (by: User, opts: { shared?: boolean, name?: string, board?: string, tokenBoards?: string[] } = {}) =>
  as(by.id, async sql => (await sql`
    insert into saved_views (board_id, user_id, created_by, name, config)
    values (${opts.board ?? boardId}, ${opts.shared ? null : by.id}, ${by.id}, ${opts.name ?? `View ${randomUUID().slice(0, 8)}`}, ${sql.json(config)})
    returning id`)[0]!.id as string, opts.tokenBoards)

const visible = (by: User, id: string) =>
  as(by.id, async sql => (await sql`select 1 from saved_views where id = ${id}`).length === 1)

const rename = (by: User, id: string, tokenBoards?: string[]) =>
  as(by.id, async sql => (await sql`update saved_views set name = ${`Renamed ${randomUUID().slice(0, 8)}`} where id = ${id}`).count, tokenBoards)

const remove = (by: User, id: string) =>
  as(by.id, async sql => (await sql`delete from saved_views where id = ${id}`).count)

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Views board')` as any
    ;[{ id: otherBoardId }] = await sql`select id from app.create_board('Other views board')` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
})

afterAll(async () => {
  await owner_`delete from boards where id in ${owner_([boardId, otherBoardId])}`
  await owner_`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner_.end()])
})

describe('saved views', () => {
  it('personal views: everyone with access can make their own, nobody else sees them', async () => {
    for (const u of [owner, editor, viewer]) {
      const id = await newView(u)
      expect(await visible(u, id)).toBe(true)
      for (const other of [owner, editor, viewer, outsider].filter(x => x !== u)) {
        expect(await visible(other, id)).toBe(false)
        expect(await rename(other, id)).toBe(0)
        expect(await remove(other, id)).toBe(0)
      }
      expect(await rename(u, id)).toBe(1)
      expect(await remove(u, id)).toBe(1)
    }
    await rejectsWith(newView(outsider), '42501')
  })

  it('cannot save a personal view for someone else', async () => {
    await rejectsWith(as(editor.id, sql => sql`
      insert into saved_views (board_id, user_id, created_by, name, config)
      values (${boardId}, ${viewer.id}, ${editor.id}, 'Theirs', ${sql.json(config)})`), '42501')
    await rejectsWith(as(editor.id, sql => sql`
      insert into saved_views (board_id, user_id, created_by, name, config)
      values (${boardId}, ${editor.id}, ${viewer.id}, 'Spoofed', ${sql.json(config)})`), '42501')
  })

  it('shared views: everyone on the board reads them, editors manage them', async () => {
    const id = await newView(editor, { shared: true })
    for (const u of [owner, editor, viewer]) expect(await visible(u, id)).toBe(true)
    expect(await visible(outsider, id)).toBe(false)
    await rejectsWith(newView(viewer, { shared: true }), '42501')
    expect(await rename(viewer, id)).toBe(0)
    expect(await remove(viewer, id)).toBe(0)
    expect(await rename(owner, id)).toBe(1)
    expect(await remove(owner, id)).toBe(1)
  })

  it('the scope is fixed', async () => {
    const id = await newView(editor)
    await rejectsWith(as(editor.id, sql => sql`update saved_views set user_id = null where id = ${id}`), '42501')
  })

  it('names are unique per user and among shared views, case-insensitively', async () => {
    const name = `Mine ${randomUUID().slice(0, 8)}`
    await newView(editor, { name })
    await rejectsWith(newView(editor, { name: name.toUpperCase() }), '23505')
    await newView(viewer, { name })
    await newView(editor, { name, shared: true })
    await rejectsWith(newView(owner, { name: name.toLowerCase(), shared: true }), '23505')
  })

  it('archived boards block shared views but keep personal ones', async () => {
    const shared = await newView(owner, { shared: true })
    await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    try {
      await rejectsWith(newView(editor, { shared: true }), '42501')
      expect(await rename(owner, shared)).toBe(0)
      const mine = await newView(viewer)
      expect(await rename(viewer, mine)).toBe(1)
    }
    finally {
      await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
    }
  })

  it('a token limited to other boards cannot touch the view', async () => {
    const id = await newView(owner)
    expect(await rename(owner, id, [otherBoardId])).toBe(0)
    expect(await rename(owner, id, [boardId])).toBe(1)
    await rejectsWith(newView(owner, { tokenBoards: [otherBoardId] }), '42501')
  })

  it('losing access hides personal views; deleting the user removes them', async () => {
    const u = await createUser('leaver')
    await as(owner.id, sql => sql`select app.add_board_member(${boardId}, ${u.email}, 'viewer')`)
    const id = await newView(u)
    await as(owner.id, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${u.id}`)
    expect(await visible(u, id)).toBe(false)
    await owner_`delete from users where id = ${u.id}`
    expect(await owner_`select 1 from saved_views where id = ${id}`).toHaveLength(0)
  })

  it('rejects config that is not an object', async () => {
    await rejectsWith(as(owner.id, sql => sql`
      insert into saved_views (board_id, user_id, created_by, name, config)
      values (${boardId}, ${owner.id}, ${owner.id}, 'Bad', ${sql.json([1, 2])})`), '23514')
  })
})
