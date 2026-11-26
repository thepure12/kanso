// app.readable_board_ids() replaces `app.board_role(board_id) IS NOT NULL` in
// the select policies (0152). It must return exactly the boards board_role
// gives a role on, for members, team members and limited tokens alike.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })

type User = { id: string, email: string }
type Token = { boards?: string[], team?: string }

function as<T>(userId: string, token: Token, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    await sql`select set_config('app.token_boards', ${token.boards ? `{${token.boards.join(',')}}` : ''}, true)`
    await sql`select set_config('app.token_team', ${token.team ?? ''}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name, email_verified_at) values (${`${name}-${randomUUID()}@test.local`}, ${name}, now()) returning id, email`
  return u as User
}

let owner: User, teamMate: User, guest: User, stranger: User
let teamId: string, otherTeamId: string
let personal: string, teamBoard: string, otherTeamBoard: string
let ids: string[]

beforeAll(async () => {
  ;[owner, teamMate, guest, stranger] = await Promise.all(['owner', 'mate', 'guest', 'stranger'].map(createUser))
  await as(owner.id, {}, async (sql) => {
    ;[{ id: teamId }] = await sql`select id from app.create_team('Readable A')` as any
    ;[{ id: otherTeamId }] = await sql`select id from app.create_team('Readable B')` as any
    await sql`select app.add_team_member(${teamId}, ${teamMate.email}, 'viewer')`
    ;[{ id: personal }] = await sql`select id from app.create_board('Personal')` as any
    ;[{ id: teamBoard }] = await sql`select id from app.create_board('Team board', ${teamId})` as any
    ;[{ id: otherTeamBoard }] = await sql`select id from app.create_board('Other team board', ${otherTeamId})` as any
    await sql`select app.add_board_member(${personal}, ${guest.email}, 'commenter')`
    await sql`select app.add_board_member(${otherTeamBoard}, ${teamMate.email}, 'editor')`
  })
  ids = [personal, teamBoard, otherTeamBoard]
})

afterAll(async () => {
  await as(owner.id, {}, async (sql) => {
    await sql`delete from boards where id in ${sql(ids)}`
    await sql`delete from teams where id in ${sql([teamId, otherTeamId])}`
  })
  await Promise.all([app.end(), auth.end()])
})

/** The test boards readable_board_ids() returns, and those board_role answers for. */
function compare(user: User, token: Token) {
  return as(user.id, token, async (sql) => {
    const set = await sql`select b from app.readable_board_ids() b where b in ${sql(ids)}`
    const role = await sql`select b from unnest(${ids}::uuid[]) b where app.board_role(b) is not null`
    const seen = await sql`select id from boards where id in ${sql(ids)}`
    return {
      set: set.map(r => r.b as string).sort(),
      role: role.map(r => r.b as string).sort(),
      seen: seen.map(r => r.id as string).sort(),
    }
  })
}

describe('app.readable_board_ids', () => {
  const cases: [string, () => User, () => Token, () => string[]][] = [
    ['owner, no token', () => owner, () => ({}), () => ids],
    ['team member and direct editor', () => teamMate, () => ({}), () => [teamBoard, otherTeamBoard]],
    ['direct board member', () => guest, () => ({}), () => [personal]],
    ['stranger', () => stranger, () => ({}), () => []],
    ['board-limited token', () => owner, () => ({ boards: [teamBoard] }), () => [teamBoard]],
    ['board-limited token on a board without access', () => guest, () => ({ boards: [teamBoard] }), () => []],
    ['team-limited token', () => owner, () => ({ team: teamId }), () => [teamBoard]],
    ['team-limited token, member of the board in another team', () => teamMate, () => ({ team: otherTeamId }), () => [otherTeamBoard]],
  ]

  for (const [name, user, token, expected] of cases) {
    it(name, async () => {
      const r = await compare(user(), token())
      expect(r.set).toEqual([...expected()].sort())
      expect(r.role).toEqual(r.set)
      expect(r.seen).toEqual(r.set)
    })
  }

  it('child tables follow it', async () => {
    await as(owner.id, {}, async (sql) => {
      await sql`insert into tags (board_id, name, color) values (${teamBoard}, 'readable', '#ff0000')`
    })
    const count = (user: User, token: Token) => as(user.id, token, sql => sql`select count(*)::int n from tags where board_id = ${teamBoard}`)
    expect((await count(teamMate, {}))[0]!.n).toBe(1)
    expect((await count(guest, {}))[0]!.n).toBe(0)
    expect((await count(owner, { boards: [personal] }))[0]!.n).toBe(0)
  })
})
