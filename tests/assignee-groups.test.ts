// RLS, board membership and copying for assignee groups. Same setup as rls.test.ts.
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
let boardId: string, otherBoardId: string
const boards: string[] = []

const newGroup = (by: User, name = `Group ${randomUUID().slice(0, 8)}`, board = boardId) =>
  as(by.id, async sql => (await sql`
    insert into assignee_groups (board_id, name) values (${board}, ${name}) returning id`)[0]!.id as string)

const addMember = (by: User, groupId: string, userId: string, board = boardId) =>
  as(by.id, sql => sql`insert into assignee_group_members (group_id, user_id, board_id) values (${groupId}, ${userId}, ${board})`)

const membersOf = (groupId: string) =>
  as(owner.id, async sql => (await sql`select user_id from assignee_group_members where group_id = ${groupId}`).map(r => r.user_id as string))

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Assignee groups board')` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
  await as(outsider.id, async (sql) => {
    ;[{ id: otherBoardId }] = await sql`select id from app.create_board('Other board')` as any
  })
})

afterAll(async () => {
  await as(owner.id, sql => sql`delete from boards where id in ${sql([boardId, ...boards])}`)
  await as(outsider.id, sql => sql`delete from boards where id = ${otherBoardId}`)
  await Promise.all([app.end(), auth.end()])
})

describe('assignee groups', () => {
  it('editors manage groups and members; viewers read only; outsiders see nothing', async () => {
    const group = await newGroup(editor)
    await addMember(editor, group, viewer.id)
    expect((await as(editor.id, sql => sql`update assignee_groups set name = 'Renamed' where id = ${group}`)).count).toBe(1)
    await as(viewer.id, async (sql) => {
      expect(await sql`select id from assignee_groups where id = ${group}`).toHaveLength(1)
      expect(await sql`select user_id from assignee_group_members where group_id = ${group}`).toHaveLength(1)
      expect((await sql`update assignee_groups set name = 'x' where id = ${group}`).count).toBe(0)
      expect((await sql`delete from assignee_group_members where group_id = ${group}`).count).toBe(0)
      expect((await sql`delete from assignee_groups where id = ${group}`).count).toBe(0)
    })
    await rejectsWith(newGroup(viewer), '42501')
    await rejectsWith(addMember(viewer, group, editor.id), '42501')
    await as(outsider.id, async (sql) => {
      expect(await sql`select id from assignee_groups where id = ${group}`).toHaveLength(0)
      expect(await sql`select user_id from assignee_group_members where group_id = ${group}`).toHaveLength(0)
    })
    expect((await as(editor.id, sql => sql`delete from assignee_groups where id = ${group}`)).count).toBe(1)
    expect(await membersOf(group)).toEqual([])
  })

  it('members must have access to the board; the group must be of the same board', async () => {
    const group = await newGroup(owner)
    await addMember(owner, group, owner.id)
    await addMember(owner, group, editor.id)
    expect((await membersOf(group)).sort()).toEqual([owner.id, editor.id].sort())
    await rejectsWith(addMember(owner, group, editor.id), '23505')
    await rejectsWith(addMember(owner, group, outsider.id), '42501')
    // The group's row claimed for another board.
    await rejectsWith(addMember(outsider, group, outsider.id, otherBoardId), '23503')
  })

  it('names are unique per board regardless of case', async () => {
    await newGroup(owner, 'Frontend')
    await rejectsWith(newGroup(editor, 'FRONTEND'), '23505')
    await rejectsWith(newGroup(owner, ''), '23514')
  })

  it('archived boards block changes', async () => {
    const group = await newGroup(owner)
    await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    try {
      await rejectsWith(newGroup(owner), '42501')
      await rejectsWith(addMember(owner, group, editor.id), '42501')
      expect((await as(owner.id, sql => sql`update assignee_groups set name = 'x' where id = ${group}`)).count).toBe(0)
    }
    finally {
      await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
    }
  })

  it('app.copy_board copies groups with the members who can access the copy', async () => {
    const src = await as(owner.id, async sql => (await sql`select id from app.create_board('Copy source')`)[0]!.id as string)
    boards.push(src)
    await as(owner.id, async (sql) => {
      await sql`select app.add_board_member(${src}, ${editor.email}, 'editor')`
      const [{ id: g }] = await sql`insert into assignee_groups (board_id, name) values (${src}, 'Crew') returning id` as any
      await sql`insert into assignee_group_members (group_id, user_id, board_id) values (${g}, ${owner.id}, ${src}), (${g}, ${editor.id}, ${src})`
    })
    const copy = await as(owner.id, async sql => (await sql`select id from app.copy_board(${src}, 'Copy', null, false)`)[0]!.id as string)
    boards.push(copy)
    // The copy is a new personal board: only the owner is on it.
    const rows = await as(owner.id, sql => sql`
      select g.name, m.user_id from assignee_groups g
      left join assignee_group_members m on m.group_id = g.id
      where g.board_id = ${copy}`)
    expect(rows).toEqual([{ name: 'Crew', user_id: owner.id }])
  })
})
