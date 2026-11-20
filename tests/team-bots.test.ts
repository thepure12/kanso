// Team bots (0106_team_bots_rls.sql): bot users made by team owners, kept in
// their own team, reaching the team's boards through team-limited tokens.
import { createHash, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const owner_ = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    return fn(sql)
  }) as Promise<T>
}

/** Like withUser for a token request: the token's user, boards and team. */
async function asToken<T>(token: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  const [t] = await auth`select * from app.resolve_api_token(${sha(token)})`
  if (!t) throw new Error('token does not resolve')
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${t.user_id}, true)`
    await sql`select set_config('app.token_boards', ${t.board_ids ? `{${t.board_ids.join(',')}}` : ''}, true)`
    await sql`select set_config('app.token_team', ${t.team_id ?? ''}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

const created: string[] = []
async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name, email_verified_at) values (${`${name}-${randomUUID()}@test.local`}, ${name}, now()) returning id, email`
  created.push(u!.id)
  return u as { id: string, email: string }
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex')

async function newBot(t: string, name = 'Bot', role = 'editor', by = owner.id) {
  const [{ id }] = await as(by, sql => sql`select app.create_team_bot(${t}, ${name}, ${role}) as id`) as any
  return id as string
}

async function newBotToken(bot: string, scopes = ['read', 'write'], by = owner.id) {
  const token = `kb_${randomUUID()}`
  const [{ id }] = await as(by, sql => sql`
    select app.create_bot_token(${bot}, 'agent', ${scopes}, null, ${sha(token)}, ${token.slice(0, 10)}) as id`) as any
  return { token, id: id as string }
}

type User = { id: string, email: string }
let owner: User, editor: User, outsider: User
let teamId: string, otherTeam: string, teamBoard: string, personalBoard: string, otherTeamBoard: string
let todoId: string

beforeAll(async () => {
  ;[owner, editor, outsider] = await Promise.all(['owner', 'editor', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: teamId }] = await sql`select id from app.create_team('Bot team')` as any
    ;[{ id: otherTeam }] = await sql`select id from app.create_team('Other team')` as any
    ;[{ id: teamBoard }] = await sql`select id from app.create_board('Team board', ${teamId})` as any
    ;[{ id: otherTeamBoard }] = await sql`select id from app.create_board('Other team board', ${otherTeam})` as any
    ;[{ id: personalBoard }] = await sql`select id from app.create_board('Personal')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${teamBoard}, 'Todo', 1) returning id` as any
    await sql`select app.add_team_member(${teamId}, ${editor.email}, 'editor')`
  })
})

afterAll(async () => {
  await owner_`delete from boards where id in (${teamBoard}, ${personalBoard}, ${otherTeamBoard})`
  await owner_`delete from teams where id in (${teamId}, ${otherTeam})`
  await owner_`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner_.end()])
})

describe('managing team bots', () => {
  it('team owners create a bot that is a team member and cannot sign in', async () => {
    const bot = await newBot(teamId, '  Helper  ')
    const [u] = await owner_`select email, name, is_bot, bot_board_id, bot_team_id, password_hash, email_verified_at from users where id = ${bot}`
    expect(u).toMatchObject({ email: `bot-${bot}@bots.invalid`, name: 'Helper', is_bot: true, bot_board_id: null, bot_team_id: teamId, password_hash: null, email_verified_at: null })
    expect(await as(editor.id, sql => sql`select user_id, role from team_members where team_id = ${teamId} and user_id = ${bot}`))
      .toEqual([{ user_id: bot, role: 'editor' }])
    expect(await as(editor.id, sql => sql`select id, is_bot, bot_team_id from users where id = ${bot}`)).toEqual([{ id: bot, is_bot: true, bot_team_id: teamId }])
    expect(await as(outsider.id, sql => sql`select id from users where id = ${bot}`)).toHaveLength(0)
    // It is on every board of the team through the team.
    expect(await as(owner.id, sql => sql`select role, team_role from app.board_people(${teamBoard}) where user_id = ${bot}`))
      .toEqual([{ role: 'editor', team_role: 'editor' }])
  })

  it('only team owners manage team bots, and bots are never owners', async () => {
    await rejectsWith(newBot(teamId, 'Nope', 'viewer', editor.id), '42501')
    await rejectsWith(newBot(teamId, 'Nope', 'viewer', outsider.id), '42501')
    await rejectsWith(newBot(teamId, 'Boss', 'owner'), '42501')
    await rejectsWith(newBot(teamId, '  ', 'viewer'), '22023')

    const bot = await newBot(teamId, 'Worker', 'viewer')
    await as(owner.id, sql => sql`select app.update_team_bot(${bot}, 'Renamed', 'commenter')`)
    const [row] = await owner_`select u.name, m.role from users u join team_members m on m.user_id = u.id and m.team_id = ${teamId} where u.id = ${bot}`
    expect(row).toEqual({ name: 'Renamed', role: 'commenter' })
    await rejectsWith(as(owner.id, sql => sql`select app.update_team_bot(${bot}, 'Renamed', 'owner')`), '42501')
    await rejectsWith(as(editor.id, sql => sql`select app.update_team_bot(${bot}, 'Mine', 'editor')`), '42501')
    await rejectsWith(as(editor.id, sql => sql`select app.delete_team_bot(${bot})`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select app.update_team_bot(${owner.id}, 'Not a bot', 'editor')`), 'P0002')
    // The board functions do not take team bots, nor the team ones board bots.
    await rejectsWith(as(owner.id, sql => sql`select app.update_board_bot(${bot}, 'X', 'editor')`), 'P0002')
    const [{ id: boardBot }] = await as(owner.id, sql => sql`select app.create_board_bot(${teamBoard}, 'Board bot', 'viewer') as id`) as any
    await rejectsWith(as(owner.id, sql => sql`select app.update_team_bot(${boardBot}, 'X', 'editor')`), 'P0002')
    // Plain member writes cannot make it an owner either.
    await rejectsWith(as(owner.id, sql => sql`update team_members set role = 'owner' where team_id = ${teamId} and user_id = ${bot}`), '42501')
  })

  it('a team bot stays in its own team: no other team, no board of its own, no leaving', async () => {
    const bot = await newBot(teamId)
    const email = `bot-${bot}@bots.invalid`
    await rejectsWith(as(owner.id, sql => sql`select app.add_team_member(${otherTeam}, ${email}, 'viewer')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`insert into team_members (team_id, user_id, role) values (${otherTeam}, ${bot}, 'viewer')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select app.add_board_member(${personalBoard}, ${email}, 'viewer')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select app.add_board_member(${teamBoard}, ${email}, 'viewer')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`delete from team_members where team_id = ${teamId} and user_id = ${bot}`), '42501')
    await rejectsWith(as(bot, sql => sql`delete from team_members where team_id = ${teamId} and user_id = ${bot}`), '42501')
    await rejectsWith(owner_`update users set bot_team_id = ${otherTeam} where id = ${bot}`, '42501')
    const id = randomUUID()
    await rejectsWith(auth`insert into users (id, email, name, is_bot, bot_team_id) values (${id}, ${`bot-${id}@bots.invalid`}, 'Fake', true, ${teamId})`, '42501')
  })
})

describe('team bot tokens', () => {
  it('team owners create tokens limited to the team; others cannot', async () => {
    const bot = await newBot(teamId)
    const { token, id } = await newBotToken(bot)
    const [t] = await auth`select * from app.resolve_api_token(${sha(token)})`
    expect(t).toMatchObject({ token_id: id, user_id: bot, scopes: ['read', 'write'], board_ids: null, team_id: teamId })

    await rejectsWith(newBotToken(bot, ['read'], editor.id), '42501')
    expect(await as(owner.id, sql => sql`select id from app.bot_tokens(${bot})`)).toEqual([{ id }])
    await rejectsWith(as(editor.id, sql => sql`select * from app.bot_tokens(${bot})`), '42501')
    await rejectsWith(as(editor.id, sql => sql`select app.revoke_bot_token(${id})`), '42501')
    await as(owner.id, sql => sql`select app.revoke_bot_token(${id})`)
    expect(await auth`select * from app.resolve_api_token(${sha(token)})`).toHaveLength(0)
  })

  it('people cannot give their own tokens a team limit', async () => {
    const own = `kb_${randomUUID()}`
    await rejectsWith(as(owner.id, sql => sql`
      insert into api_tokens (user_id, name, token_hash, prefix, scopes, team_id) values (${owner.id}, 'mine', ${sha(own)}, 'kb_x', '{read}', ${teamId})`), '42501')
  })

  it('a team bot acts on the team boards with its team role, later boards too, and reaches nothing else', async () => {
    const writer = await newBot(teamId, 'Writer', 'editor')
    const reader = await newBot(teamId, 'Reader', 'viewer')
    const { token: writeToken } = await newBotToken(writer)
    const { token: readToken } = await newBotToken(reader)

    await asToken(writeToken, async (sql) => {
      expect((await sql`select id from boards`).map(r => r.id)).toEqual([teamBoard])
      expect((await sql`select id from teams`).map(r => r.id)).toEqual([teamId])
      expect(await sql`select app.team_role(${teamId}) as r`).toEqual([{ r: 'editor' }])
      const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${teamBoard}, ${todoId}, 'By team bot', 1, ${writer}) returning id`
      expect(c).toBeTruthy()
    })
    await rejectsWith(asToken(writeToken, sql => sql`select app.create_board('Nope', ${teamId})`), '42501')
    await rejectsWith(asToken(writeToken, sql => sql`select app.create_team('Nope')`), '42501')
    await rejectsWith(asToken(writeToken, sql => sql`select app.create_team_bot(${teamId}, 'Child', 'viewer')`), '42501')
    await rejectsWith(asToken(readToken, sql => sql`insert into cards (board_id, column_id, title, position, created_by) values (${teamBoard}, ${todoId}, 'No', 2, ${reader})`), '42501')

    // A board made later in the team is reachable too.
    const [{ id: later }] = await as(owner.id, sql => sql`select id from app.create_board('Later', ${teamId})`) as any
    try {
      await asToken(readToken, async (sql) => {
        expect((await sql`select id from boards order by name`).map(r => r.id).sort()).toEqual([later, teamBoard].sort())
      })
    }
    finally {
      await owner_`delete from boards where id = ${later}`
    }
  })

  it('a team-limited token of a person in several teams sees only that team', async () => {
    // Team tokens exist only for bots, but the limit itself does not depend on it.
    await as(owner.id, async (sql) => {
      await sql`select set_config('app.token_team', ${teamId}, true)`
      expect((await sql`select id from boards where id in (${teamBoard}, ${personalBoard}, ${otherTeamBoard})`).map(r => r.id)).toEqual([teamBoard])
      expect(await sql`select app.team_role(${otherTeam}) as r`).toEqual([{ r: null }])
      expect(await sql`select app.team_role(${teamId}) as r`).toEqual([{ r: 'owner' }])
    })
  })
})

describe('deleting team bots', () => {
  it('deleting a team bot keeps its work with a null creator and drops its tokens', async () => {
    const bot = await newBot(teamId, 'Temp', 'editor')
    const { token } = await newBotToken(bot)
    const cardId = await asToken(token, async (sql) => {
      const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${teamBoard}, ${todoId}, 'Temp work', 3, ${bot}) returning id`
      await sql`insert into card_assignees (card_id, board_id, user_id) values (${c!.id}, ${teamBoard}, ${bot})`
      return c!.id as string
    })
    await as(owner.id, sql => sql`select app.delete_team_bot(${bot})`)
    expect(await owner_`select 1 from users where id = ${bot}`).toHaveLength(0)
    expect(await auth`select * from app.resolve_api_token(${sha(token)})`).toHaveLength(0)
    expect(await owner_`select created_by from cards where id = ${cardId}`).toEqual([{ created_by: null }])
    expect(await owner_`select 1 from card_assignees where card_id = ${cardId}`).toHaveLength(0)
  })

  it('deleting the team deletes its bots and their tokens', async () => {
    const [{ id: t }] = await as(owner.id, sql => sql`select id from app.create_team('Short-lived')`) as any
    const bot = await newBot(t)
    const { token } = await newBotToken(bot)
    await as(owner.id, sql => sql`delete from teams where id = ${t}`)
    expect(await owner_`select 1 from users where id = ${bot}`).toHaveLength(0)
    expect(await auth`select * from app.resolve_api_token(${sha(token)})`).toHaveLength(0)
  })

  it('a bot never inherits a team or board from a removed owner', async () => {
    const solo = await createUser('solo')
    const [{ id: t }] = await as(solo.id, sql => sql`select id from app.create_team('Solo team')`) as any
    const [{ id: b }] = await as(solo.id, sql => sql`select id from app.create_board('Solo board')`) as any
    await newBot(t, 'Team bot', 'editor', solo.id)
    await as(solo.id, sql => sql`select app.create_board_bot(${b}, 'Board bot', 'editor')`)
    await as(solo.id, sql => sql`select app.delete_my_account()`)
    expect(await owner_`select 1 from teams where id = ${t}`).toHaveLength(0)
    expect(await owner_`select 1 from boards where id = ${b}`).toHaveLength(0)
    await owner_`delete from admin_audit_log where action = 'user.delete_self' and data ->> 'target_email' = ${solo.email}`
  })
})
