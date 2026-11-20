// Account bots (0109_account_bots_rls.sql): bots owned by a person, added by
// that person to boards they own, with tokens that follow the bot's boards.
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

async function newBot(by: string, name = 'Bot') {
  const [{ id }] = await as(by, sql => sql`select app.create_account_bot(${name}) as id`) as any
  return id as string
}

type User = { id: string, email: string }
let alice: User, bob: User, outsider: User
let aliceBoard: string, bobBoard: string, teamId: string

beforeAll(async () => {
  ;[alice, bob, outsider] = await Promise.all(['alice', 'bob', 'outsider'].map(createUser)) as User[]
  await as(alice.id, async (sql) => {
    ;[{ id: aliceBoard }] = await sql`select id from app.create_board('Alice board')` as any
    ;[{ id: teamId }] = await sql`select id from app.create_team('Alice team')` as any
    await sql`select app.add_board_member(${aliceBoard}, ${bob.email}, 'owner')`
  })
  await as(bob.id, async (sql) => {
    ;[{ id: bobBoard }] = await sql`select id from app.create_board('Bob board')` as any
  })
})

afterAll(async () => {
  await owner_`delete from boards where id in (${aliceBoard}, ${bobBoard})`
  await owner_`delete from teams where id = ${teamId}`
  await owner_`delete from users where bot_owner_id = any(${created})`
  await owner_`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner_.end()])
})

describe('making account bots', () => {
  it('a person makes bots of their own, sees them, renames and deletes them; others cannot', async () => {
    const bot = await newBot(alice.id, '  Helper ')
    const [row] = await owner_`select name, is_bot, bot_owner_id, bot_board_id, bot_team_id, email_verified_at from users where id = ${bot}`
    expect(row).toMatchObject({ name: 'Helper', is_bot: true, bot_owner_id: alice.id, bot_board_id: null, bot_team_id: null, email_verified_at: null })
    // Visible to its owner while on no board, not to others.
    expect(await as(alice.id, sql => sql`select id from users where id = ${bot}`)).toHaveLength(1)
    expect(await as(bob.id, sql => sql`select id from users where id = ${bot}`)).toHaveLength(0)

    await as(alice.id, sql => sql`select app.rename_account_bot(${bot}, 'Renamed')`)
    await rejectsWith(as(bob.id, sql => sql`select app.rename_account_bot(${bot}, 'Mine')`), '42501')
    await rejectsWith(as(bob.id, sql => sql`select app.delete_account_bot(${bot})`), '42501')
    await rejectsWith(as(alice.id, sql => sql`select app.rename_account_bot(${randomUUID()}, 'x')`), 'P0002')
    await rejectsWith(as(alice.id, sql => sql`select app.rename_account_bot(${bot}, '')`), '22023')
    // Nobody hands it to someone else.
    await rejectsWith(owner_`update users set bot_owner_id = ${bob.id} where id = ${bot}`, '42501')

    await as(alice.id, sql => sql`select app.delete_account_bot(${bot})`)
    expect(await owner_`select id from users where id = ${bot}`).toHaveLength(0)
  })

  it('bots and limited tokens make no account bots; at most 20 per person', async () => {
    const bot = await newBot(outsider.id)
    await rejectsWith(as(bot, sql => sql`select app.create_account_bot('Child')`), '42501')
    await rejectsWith(app.begin(async (sql) => {
      await sql`select set_config('app.user_id', ${outsider.id}, true)`
      await sql`select set_config('app.token_boards', ${`{${aliceBoard}}`}, true)`
      return sql`select app.create_account_bot('Limited')`
    }), '42501')
    for (let i = 1; i < 20; i++) await newBot(outsider.id, `Bot ${i}`)
    await rejectsWith(as(outsider.id, sql => sql`select app.create_account_bot('One too many')`), 'KB011')
    await owner_`delete from users where bot_owner_id = ${outsider.id}`
  })
})

describe('account bots on boards', () => {
  it('only the owner adds the bot, only to boards they own, never as owner', async () => {
    const bot = await newBot(alice.id)
    const [{ email }] = await owner_`select email from users where id = ${bot}`

    await rejectsWith(as(alice.id, sql => sql`select app.add_account_bot_to_board(${bot}, ${bobBoard}, 'editor')`), '42501')
    await rejectsWith(as(alice.id, sql => sql`select app.add_account_bot_to_board(${bot}, ${aliceBoard}, 'owner')`), '42501')
    // Bob owns Alice's board too, but the bot is not his.
    await rejectsWith(as(bob.id, sql => sql`select app.add_board_member(${aliceBoard}, ${email}, 'editor')`), '42501')
    await rejectsWith(as(bob.id, sql => sql`select app.add_account_bot_to_board(${bot}, ${aliceBoard}, 'editor')`), '42501')
    // Never in a team.
    await rejectsWith(as(alice.id, sql => sql`select app.add_team_member(${teamId}, ${email}, 'editor')`), '42501')

    await as(alice.id, sql => sql`select app.add_board_member(${aliceBoard}, ${email}, 'commenter')`)
    expect(await as(alice.id, sql => sql`select bot_id, board_id, role, owner from app.my_bot_boards()`))
      .toEqual([{ bot_id: bot, board_id: aliceBoard, role: 'commenter', owner: true }])
    expect(await as(bob.id, sql => sql`select * from app.my_bot_boards()`)).toEqual([])

    // Board owners re-role it (not to owner) and remove it like a member.
    await rejectsWith(as(bob.id, sql => sql`update board_members set role = 'owner' where board_id = ${aliceBoard} and user_id = ${bot}`), '42501')
    await as(bob.id, sql => sql`update board_members set role = 'viewer' where board_id = ${aliceBoard} and user_id = ${bot}`)
    await as(bob.id, sql => sql`delete from board_members where board_id = ${aliceBoard} and user_id = ${bot}`)
    expect(await owner_`select 1 from board_members where user_id = ${bot}`).toHaveLength(0)

    // The owner takes it off a board, also one they no longer see.
    await as(alice.id, sql => sql`select app.add_account_bot_to_board(${bot}, ${aliceBoard}, 'editor')`)
    await rejectsWith(as(bob.id, sql => sql`select app.remove_account_bot_from_board(${bot}, ${aliceBoard})`), '42501')
    await as(alice.id, sql => sql`select app.remove_account_bot_from_board(${bot}, ${aliceBoard})`)
    expect(await owner_`select 1 from board_members where user_id = ${bot}`).toHaveLength(0)
    await as(alice.id, sql => sql`select app.delete_account_bot(${bot})`)
  })

  it('its tokens follow its boards and make no boards or teams', async () => {
    const bot = await newBot(alice.id)
    const token = `kb_${randomUUID()}`
    await as(alice.id, sql => sql`select app.create_bot_token(${bot}, 'agent', ${['read', 'write']}, null, ${sha(token)}, ${token.slice(0, 10)})`)
    await rejectsWith(as(bob.id, sql => sql`select * from app.bot_tokens(${bot})`), '42501')
    const [t] = await owner_`select board_ids, team_id from api_tokens where user_id = ${bot}`
    expect(t).toEqual({ board_ids: null, team_id: null })

    expect(await asToken(token, sql => sql`select id from boards`)).toEqual([])
    await as(alice.id, sql => sql`select app.add_account_bot_to_board(${bot}, ${aliceBoard}, 'editor')`)
    expect(await asToken(token, sql => sql`select id from boards`)).toEqual([{ id: aliceBoard }])
    expect(await asToken(token, sql => sql`select app.board_role(${aliceBoard}) as role`)).toEqual([{ role: 'editor' }])

    await rejectsWith(asToken(token, sql => sql`select app.create_board('Mine')`), '42501')
    await rejectsWith(asToken(token, sql => sql`select app.create_team('Mine')`), '42501')
    await as(alice.id, sql => sql`select app.delete_account_bot(${bot})`)
    expect(await owner_`select 1 from api_tokens where user_id = ${bot}`).toHaveLength(0)
  })

  it('deleting the owner\'s account deletes the bots; losing the board keeps them there', async () => {
    const carol = await createUser('carol')
    const bot = await newBot(carol.id)
    await as(alice.id, sql => sql`select app.add_board_member(${aliceBoard}, ${carol.email}, 'owner')`)
    await as(carol.id, sql => sql`select app.add_account_bot_to_board(${bot}, ${aliceBoard}, 'editor')`)
    await as(alice.id, sql => sql`update board_members set role = 'viewer' where board_id = ${aliceBoard} and user_id = ${carol.id}`)
    expect(await owner_`select role from board_members where board_id = ${aliceBoard} and user_id = ${bot}`).toEqual([{ role: 'editor' }])

    await as(carol.id, sql => sql`select app.delete_my_account()`)
    expect(await owner_`select id from users where id in (${carol.id}, ${bot})`).toHaveLength(0)
  })
})
