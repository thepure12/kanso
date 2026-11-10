// RLS, same-board membership and copying for column groups. Same setup as rls.test.ts.
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
let owner: User, editor: User, viewer: User, outsider: User
let boardId: string, otherBoardId: string, todo: string, doing: string, otherColumn: string
const boards: string[] = []

const newGroup = (by: User, name = `Group ${randomUUID().slice(0, 8)}`, board = boardId) =>
  as(by.id, async sql => (await sql`
    insert into column_groups (board_id, name, position) values (${board}, ${name}, 1) returning id`)[0]!.id as string)

const addMember = (by: User, groupId: string, columnId: string, board = boardId) =>
  as(by.id, sql => sql`insert into column_group_members (group_id, column_id, board_id) values (${groupId}, ${columnId}, ${board})`)

const membersOf = (groupId: string) =>
  as(owner.id, async sql => (await sql`select column_id from column_group_members where group_id = ${groupId}`).map(r => r.column_id as string))

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Groups board')` as any
    ;[{ id: todo }, { id: doing }] = await sql`
      insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1), (${boardId}, 'Doing', 2) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
  await as(outsider.id, async (sql) => {
    ;[{ id: otherBoardId }] = await sql`select id from app.create_board('Other board')` as any
    ;[{ id: otherColumn }] = await sql`insert into columns (board_id, title, position) values (${otherBoardId}, 'Todo', 1) returning id` as any
  })
})

afterAll(async () => {
  await as(owner.id, sql => sql`delete from boards where id in ${sql([boardId, ...boards])}`)
  await as(outsider.id, sql => sql`delete from boards where id = ${otherBoardId}`)
  await Promise.all([app.end(), auth.end()])
})

describe('column groups', () => {
  it('editors manage groups and members; viewers read only; outsiders see nothing', async () => {
    const group = await newGroup(editor)
    await addMember(editor, group, todo)
    expect((await as(editor.id, sql => sql`update column_groups set color = '#22c55e' where id = ${group}`)).count).toBe(1)
    await as(viewer.id, async (sql) => {
      expect(await sql`select id from column_groups where id = ${group}`).toHaveLength(1)
      expect(await sql`select column_id from column_group_members where group_id = ${group}`).toHaveLength(1)
      expect((await sql`update column_groups set name = 'x' where id = ${group}`).count).toBe(0)
      expect((await sql`delete from column_group_members where group_id = ${group}`).count).toBe(0)
      expect((await sql`delete from column_groups where id = ${group}`).count).toBe(0)
    })
    await rejectsWith(newGroup(viewer), '42501')
    await rejectsWith(addMember(viewer, group, doing), '42501')
    await as(outsider.id, async (sql) => {
      expect(await sql`select id from column_groups where id = ${group}`).toHaveLength(0)
      expect(await sql`select column_id from column_group_members where group_id = ${group}`).toHaveLength(0)
    })
    expect((await as(editor.id, sql => sql`delete from column_group_members where group_id = ${group}`)).count).toBe(1)
    expect((await as(editor.id, sql => sql`delete from column_groups where id = ${group}`)).count).toBe(1)
  })

  it('a column can be in several groups, only of its own board', async () => {
    const [a, b] = [await newGroup(owner), await newGroup(owner)]
    await addMember(owner, a, todo)
    await addMember(owner, b, todo)
    await addMember(owner, b, doing)
    expect((await membersOf(b)).sort()).toEqual([todo, doing].sort())
    await rejectsWith(addMember(owner, a, todo), '23505')
    // A column of another board, claimed as this board's or as its own.
    await rejectsWith(addMember(owner, a, otherColumn), '23503')
    await rejectsWith(addMember(owner, a, otherColumn, otherBoardId), '42501')
  })

  it('names are unique per board regardless of case', async () => {
    await newGroup(owner, 'Dev team')
    await rejectsWith(newGroup(editor, 'dev TEAM'), '23505')
    await rejectsWith(newGroup(owner, ''), '23514')
  })

  it('deleting a column or group removes the memberships', async () => {
    const group = await newGroup(owner)
    const col = await as(owner.id, async sql => (await sql`insert into columns (board_id, title, position) values (${boardId}, 'Tmp', 9) returning id`)[0]!.id as string)
    await addMember(owner, group, col)
    await addMember(owner, group, todo)
    await as(owner.id, sql => sql`delete from columns where id = ${col}`)
    expect(await membersOf(group)).toEqual([todo])
    await as(owner.id, sql => sql`delete from column_groups where id = ${group}`)
    expect(await membersOf(group)).toEqual([])
  })

  it('archived boards block changes', async () => {
    const group = await newGroup(owner)
    await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    try {
      await rejectsWith(newGroup(owner), '42501')
      expect((await as(owner.id, sql => sql`update column_groups set name = 'x' where id = ${group}`)).count).toBe(0)
    }
    finally {
      await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
    }
  })

  it('app.copy_board copies groups and their columns', async () => {
    const src = await as(owner.id, async sql => (await sql`select id from app.create_board('Copy source')`)[0]!.id as string)
    boards.push(src)
    await as(owner.id, async (sql) => {
      const [{ id: c1 }, { id: c2 }] = await sql`insert into columns (board_id, title, position) values (${src}, 'A', 1), (${src}, 'B', 2) returning id` as any
      const [{ id: g }] = await sql`insert into column_groups (board_id, name, color, position) values (${src}, 'Both', '#3b82f6', 1) returning id` as any
      await sql`insert into column_group_members (group_id, column_id, board_id) values (${g}, ${c1}, ${src}), (${g}, ${c2}, ${src})`
    })
    const copy = await as(owner.id, async sql => (await sql`select id from app.copy_board(${src}, 'Copy', null, false)`)[0]!.id as string)
    boards.push(copy)
    const rows = await as(owner.id, sql => sql`
      select g.name, g.color, c.title from column_groups g
      join column_group_members m on m.group_id = g.id join columns c on c.id = m.column_id
      where g.board_id = ${copy} order by c.title`)
    expect(rows).toEqual([{ name: 'Both', color: '#3b82f6', title: 'A' }, { name: 'Both', color: '#3b82f6', title: 'B' }])
  })
})
