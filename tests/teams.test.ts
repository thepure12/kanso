// RLS tests for teams. Same setup as rls.test.ts.
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

let owner: { id: string, email: string }
let editor: { id: string, email: string }
let viewer: { id: string, email: string }
let outsider: { id: string, email: string }
let guest: { id: string, email: string }
let teamId: string
let boardId: string
let columnId: string

beforeAll(async () => {
  ;[owner, editor, viewer, outsider, guest] = await Promise.all(['owner', 'editor', 'viewer', 'outsider', 'guest'].map(createUser))
  await as(owner.id, async (sql) => {
    ;[{ id: teamId }] = await sql`select id from app.create_team('Acme')` as any
    await sql`select app.add_team_member(${teamId}, ${editor.email}, 'editor')`
    await sql`select app.add_team_member(${teamId}, ${viewer.email}, 'viewer')`
  })
  // A team editor creates the board; it belongs to the team, not to them.
  await as(editor.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Team board', ${teamId})` as any
    ;[{ id: columnId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
  })
})

afterAll(async () => {
  await as(owner.id, sql => sql`delete from teams where id = ${teamId}`)
  await Promise.all([app.end(), auth.end()])
})

describe('teams', () => {
  it('team roles apply to every team board', async () => {
    const role = (u: string) => as(u, async sql => (await sql`select app.board_role(${boardId}) as r`)[0]!.r)
    expect(await role(owner.id)).toBe('owner')
    expect(await role(editor.id)).toBe('editor')
    expect(await role(viewer.id)).toBe('viewer')
    expect(await role(outsider.id)).toBeNull()
  })

  it('team boards get no direct members', async () => {
    expect(await as(owner.id, sql => sql`select user_id from board_members where board_id = ${boardId}`)).toHaveLength(0)
  })

  it('viewer reads but cannot write; editor writes', async () => {
    await rejectsWith(as(viewer.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'x', 1, ${viewer.id})`), '42501')
    await as(editor.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'x', 1, ${editor.id})`)
    expect(await as(viewer.id, sql => sql`select id from cards where board_id = ${boardId}`)).toHaveLength(1)
  })

  it('outsider sees no team, boards or members', async () => {
    await as(outsider.id, async (sql) => {
      expect(await sql`select id from teams where id = ${teamId}`).toHaveLength(0)
      expect(await sql`select user_id from team_members where team_id = ${teamId}`).toHaveLength(0)
      expect(await sql`select id from boards where id = ${boardId}`).toHaveLength(0)
      expect(await sql`select * from app.board_people(${boardId})`).toHaveLength(0)
      expect((await sql`update teams set name = 'x' where id = ${teamId}`).count).toBe(0)
    })
    await rejectsWith(as(outsider.id, sql => sql`select app.create_board('x', ${teamId})`), '42501')
    await rejectsWith(as(outsider.id, sql => sql`insert into team_members (team_id, user_id, role) values (${teamId}, ${outsider.id}, 'owner')`), '42501')
  })

  it('only team owners manage the team', async () => {
    await rejectsWith(as(editor.id, sql => sql`select app.add_team_member(${teamId}, ${outsider.email}, 'viewer')`), '42501')
    await rejectsWith(as(viewer.id, sql => sql`select app.create_board('x', ${teamId})`), '42501')
    expect((await as(editor.id, sql => sql`update team_members set role = 'owner' where team_id = ${teamId} and user_id = ${editor.id}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`delete from teams where id = ${teamId}`)).count).toBe(0)
    // board owner rights on team boards come from team ownership
    expect((await as(editor.id, sql => sql`update boards set name = 'x' where id = ${boardId}`)).count).toBe(0)
    expect((await as(owner.id, sql => sql`update boards set name = 'Renamed' where id = ${boardId}`)).count).toBe(1)
  })

  it('board team cannot be changed', async () => {
    await rejectsWith(as(owner.id, sql => sql`update boards set team_id = null where id = ${boardId}`), '42501')
  })

  it('guest added to one board sees only that board, and team members see the guest', async () => {
    await as(owner.id, sql => sql`select app.add_board_member(${boardId}, ${guest.email}, 'viewer')`)
    await as(guest.id, async (sql) => {
      expect(await sql`select id from boards where id = ${boardId}`).toHaveLength(1)
      expect(await sql`select id from teams where id = ${teamId}`).toHaveLength(0)
      expect(await sql`select id from users where id = ${owner.id}`).toHaveLength(1)
    })
    expect(await as(viewer.id, sql => sql`select id from users where id = ${guest.id}`)).toHaveLength(1)
    const people = await as(viewer.id, sql => sql`select user_id, role, board_role, team_role from app.board_people(${boardId})`)
    expect(people).toHaveLength(4)
  })

  it('stronger of direct and team role wins', async () => {
    await as(owner.id, sql => sql`select app.add_board_member(${boardId}, ${viewer.email}, 'editor')`)
    expect((await as(viewer.id, sql => sql`select app.board_role(${boardId}) as r`))[0]!.r).toBe('editor')
  })

  it('last team owner cannot leave; members can', async () => {
    await rejectsWith(as(owner.id, sql => sql`delete from team_members where team_id = ${teamId} and user_id = ${owner.id}`), '23514')
    await as(editor.id, sql => sql`delete from team_members where team_id = ${teamId} and user_id = ${editor.id}`)
    expect(await as(editor.id, sql => sql`select id from boards where id = ${boardId}`)).toHaveLength(0)
  })

  it('deleting the team deletes its boards', async () => {
    const t = await as(outsider.id, async (sql) => {
      const [team] = await sql`select id from app.create_team('Temp')`
      await sql`select app.create_board('b', ${team!.id})`
      return team!.id as string
    })
    expect((await as(outsider.id, sql => sql`delete from teams where id = ${t}`)).count).toBe(1)
    expect(await as(outsider.id, sql => sql`select id from boards`)).toHaveLength(0)
  })
})
