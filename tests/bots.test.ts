// Board bots (0102_board_bots_rls.sql): bot users made by board owners, kept
// on their own board, never signing in, acting through board-limited tokens.
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

/** Like withUser for a token request: the token's user and boards. */
async function asToken<T>(token: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  const [t] = await auth`select * from app.resolve_api_token(${sha(token)})`
  if (!t) throw new Error('token does not resolve')
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${t.user_id}, true)`
    await sql`select set_config('app.token_boards', ${t.board_ids ? `{${t.board_ids.join(',')}}` : ''}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

const created: string[] = []
async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  created.push(u!.id)
  return u as { id: string, email: string }
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex')

async function newBot(b: string, name = 'Bot', role = 'editor') {
  const [{ id }] = await as(owner.id, sql => sql`select app.create_board_bot(${b}, ${name}, ${role}) as id`) as any
  return id as string
}

async function newBotToken(bot: string, scopes = ['read', 'write'], by = owner.id) {
  const token = `kb_${randomUUID()}`
  const [{ id }] = await as(by, sql => sql`
    select app.create_bot_token(${bot}, 'agent', ${scopes}, null, ${sha(token)}, ${token.slice(0, 10)}) as id`) as any
  return { token, id: id as string }
}

type User = { id: string, email: string }
let owner: User, editor: User, viewer: User, outsider: User
let boardId: string, otherBoard: string, teamId: string
let todoId: string

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Bot board')` as any
    ;[{ id: otherBoard }] = await sql`select id from app.create_board('Other board')` as any
    ;[{ id: teamId }] = await sql`select id from app.create_team('Bot team')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
})

afterAll(async () => {
  await as(owner.id, async (sql) => {
    await sql`delete from boards where id in (${boardId}, ${otherBoard})`
    await sql`delete from teams where id = ${teamId}`
  })
  await owner_`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner_.end()])
})

describe('managing bots', () => {
  it('owners create a bot that is a member of the board and cannot sign in', async () => {
    const bot = await newBot(boardId, '  Helper  ')
    const [u] = await owner_`select email, name, is_bot, bot_board_id, password_hash, email_verified_at from users where id = ${bot}`
    expect(u).toMatchObject({ email: `bot-${bot}@bots.invalid`, name: 'Helper', is_bot: true, bot_board_id: boardId, password_hash: null, email_verified_at: null })
    // Board members see it as a member and as a user; outsiders do not.
    const members = await as(viewer.id, sql => sql`select user_id, role from board_members where board_id = ${boardId} and user_id = ${bot}`)
    expect(members).toEqual([{ user_id: bot, role: 'editor' }])
    expect(await as(viewer.id, sql => sql`select id, is_bot from users where id = ${bot}`)).toEqual([{ id: bot, is_bot: true }])
    expect(await as(outsider.id, sql => sql`select id from users where id = ${bot}`)).toHaveLength(0)
  })

  it('only owners manage bots, and bots are never owners', async () => {
    await rejectsWith(as(editor.id, sql => sql`select app.create_board_bot(${boardId}, 'Nope', 'viewer')`), '42501')
    await rejectsWith(as(viewer.id, sql => sql`select app.create_board_bot(${boardId}, 'Nope', 'viewer')`), '42501')
    await rejectsWith(as(outsider.id, sql => sql`select app.create_board_bot(${boardId}, 'Nope', 'viewer')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select app.create_board_bot(${boardId}, 'Boss', 'owner')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select app.create_board_bot(${boardId}, '  ', 'viewer')`), '22023')

    const bot = await newBot(boardId, 'Worker', 'viewer')
    await as(owner.id, sql => sql`select app.update_board_bot(${bot}, 'Renamed', 'commenter')`)
    const [row] = await owner_`select u.name, m.role from users u join board_members m on m.user_id = u.id and m.board_id = ${boardId} where u.id = ${bot}`
    expect(row).toEqual({ name: 'Renamed', role: 'commenter' })
    await rejectsWith(as(owner.id, sql => sql`select app.update_board_bot(${bot}, 'Renamed', 'owner')`), '42501')
    await rejectsWith(as(editor.id, sql => sql`select app.update_board_bot(${bot}, 'Mine', 'editor')`), '42501')
    await rejectsWith(as(editor.id, sql => sql`select app.delete_board_bot(${bot})`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select app.update_board_bot(${owner.id}, 'Not a bot', 'editor')`), 'P0002')
    // Plain member writes cannot make it an owner either.
    await rejectsWith(as(owner.id, sql => sql`update board_members set role = 'owner' where board_id = ${boardId} and user_id = ${bot}`), '42501')
  })

  it('a bot stays on its own board: no other board, no team, no leaving', async () => {
    const bot = await newBot(boardId)
    const email = `bot-${bot}@bots.invalid`
    await rejectsWith(as(owner.id, sql => sql`select app.add_board_member(${otherBoard}, ${email}, 'viewer')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`insert into board_members (board_id, user_id, role) values (${otherBoard}, ${bot}, 'viewer')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select app.add_team_member(${teamId}, ${email}, 'viewer')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`insert into team_members (team_id, user_id, role) values (${teamId}, ${bot}, 'viewer')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${bot}`), '42501')
    await rejectsWith(as(bot, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${bot}`), '42501')
  })

  it('bots never get a password, verified email, OAuth account, session or admin rights', async () => {
    const bot = await newBot(boardId)
    await rejectsWith(auth`update users set password_hash = 'x' where id = ${bot}`, '42501')
    await rejectsWith(auth`update users set email_verified_at = now() where id = ${bot}`, '42501')
    await rejectsWith(auth`update users set email = ${`taken-${randomUUID()}@test.local`} where id = ${bot}`, '42501')
    await rejectsWith(auth`insert into oauth_accounts (provider, provider_user_id, user_id) values ('github', ${randomUUID()}, ${bot})`, '42501')
    await rejectsWith(auth`insert into user_sessions (user_id) values (${bot})`, '42501')
    await rejectsWith(owner_`insert into instance_admins (user_id) values (${bot})`, '42501')
    await auth`select app.bootstrap_admin(${bot}, ${`bot-${bot}@bots.invalid`})`
    expect(await owner_`select 1 from instance_admins where user_id = ${bot}`).toHaveLength(0)
    // Nobody makes bots by hand or turns an account into one.
    const id = randomUUID()
    await rejectsWith(auth`insert into users (id, email, name, is_bot, bot_board_id) values (${id}, ${`bot-${id}@bots.invalid`}, 'Fake', true, ${boardId})`, '42501')
    await rejectsWith(auth`update users set is_bot = true, bot_board_id = ${boardId}, email = ${`bot-${outsider.id}@bots.invalid`} where id = ${outsider.id}`, '42501')
    await rejectsWith(owner_`update users set bot_board_id = ${otherBoard} where id = ${bot}`, '42501')
  })
})

describe('bot pictures', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const url = (bot: string) => `/kanso/api/users/${bot}/avatar?v=abc123`

  it('owners set and remove a bot picture that board members see', async () => {
    const bot = await newBot(boardId, 'Pictured')
    await as(owner.id, sql => sql`select app.set_bot_avatar(${bot}, 'image/png', ${png}, ${url(bot)})`)
    expect(await owner_`select avatar_url from users where id = ${bot}`).toEqual([{ avatar_url: url(bot) }])
    const seen = await as(viewer.id, sql => sql`select content_type, size from user_avatars where user_id = ${bot}`)
    expect(seen).toEqual([{ content_type: 'image/png', size: png.length }])
    expect(await as(outsider.id, sql => sql`select 1 from user_avatars where user_id = ${bot}`)).toHaveLength(0)

    // Replacing keeps one row.
    await as(owner.id, sql => sql`select app.set_bot_avatar(${bot}, 'image/webp', ${png}, ${`/api/users/${bot}/avatar?v=ff`})`)
    expect(await owner_`select content_type from user_avatars where user_id = ${bot}`).toEqual([{ content_type: 'image/webp' }])

    await as(owner.id, sql => sql`select app.clear_bot_avatar(${bot})`)
    expect(await owner_`select avatar_url from users where id = ${bot}`).toEqual([{ avatar_url: null }])
    expect(await owner_`select 1 from user_avatars where user_id = ${bot}`).toHaveLength(0)
  })

  it('only owners change it, only for bots, only with the bot\'s own avatar URL and an image', async () => {
    const bot = await newBot(boardId, 'Guarded')
    await rejectsWith(as(editor.id, sql => sql`select app.set_bot_avatar(${bot}, 'image/png', ${png}, ${url(bot)})`), '42501')
    await rejectsWith(as(outsider.id, sql => sql`select app.clear_bot_avatar(${bot})`), '42501')
    await rejectsWith(as(bot, sql => sql`select app.set_bot_avatar(${bot}, 'image/png', ${png}, ${url(bot)})`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select app.set_bot_avatar(${editor.id}, 'image/png', ${png}, ${url(editor.id)})`), 'P0002')
    await rejectsWith(as(owner.id, sql => sql`select app.set_bot_avatar(${bot}, 'image/png', ${png}, 'https://evil.test/x.png')`), '22023')
    await rejectsWith(as(owner.id, sql => sql`select app.set_bot_avatar(${bot}, 'image/png', ${png}, ${url(editor.id)})`), '22023')
    await rejectsWith(as(owner.id, sql => sql`select app.set_bot_avatar(${bot}, 'image/svg+xml', ${png}, ${url(bot)})`), '23514')
    // Bots still cannot use the personal policies for someone else's row.
    await rejectsWith(as(owner.id, sql => sql`insert into user_avatars (user_id, content_type, size, data) values (${bot}, 'image/png', ${png.length}, ${png})`), '42501')
  })
})

describe('bot tokens', () => {
  it('owners create tokens limited to the bot board; others cannot', async () => {
    const bot = await newBot(boardId)
    const { token, id } = await newBotToken(bot, ['write', 'read', 'write'])
    const [t] = await auth`select * from app.resolve_api_token(${sha(token)})`
    expect(t).toMatchObject({ token_id: id, user_id: bot, scopes: ['read', 'write'], board_ids: [boardId] })

    await rejectsWith(newBotToken(bot, ['read'], editor.id), '42501')
    await rejectsWith(newBotToken(bot, ['admin']), '22023')
    await rejectsWith(newBotToken(bot, []), '22023')
    await rejectsWith(newBotToken(owner.id), 'P0002')

    const list = await as(owner.id, sql => sql`select id, name, scopes, revoked_at from app.bot_tokens(${bot})`)
    expect(list).toEqual([{ id, name: 'agent', scopes: ['read', 'write'], revoked_at: null }])
    expect(Object.keys((await as(owner.id, sql => sql`select * from app.bot_tokens(${bot})`))[0]!)).not.toContain('token_hash')
    await rejectsWith(as(editor.id, sql => sql`select * from app.bot_tokens(${bot})`), '42501')

    await rejectsWith(as(editor.id, sql => sql`select app.revoke_bot_token(${id})`), '42501')
    await as(owner.id, sql => sql`select app.revoke_bot_token(${id})`)
    expect(await auth`select * from app.resolve_api_token(${sha(token)})`).toHaveLength(0)
    // A person's own token is not a bot token.
    const own = `kb_${randomUUID()}`
    const [{ id: ownId }] = await as(owner.id, sql => sql`
      insert into api_tokens (user_id, name, token_hash, prefix, scopes) values (${owner.id}, 'mine', ${sha(own)}, 'kb_x', '{read}') returning id`) as any
    await rejectsWith(as(owner.id, sql => sql`select app.revoke_bot_token(${ownId})`), 'P0002')
  })

  it('a bot acts on its board with its role and reaches nothing else', async () => {
    const writer = await newBot(boardId, 'Writer', 'editor')
    const reader = await newBot(boardId, 'Reader', 'viewer')
    const { token: writeToken } = await newBotToken(writer)
    const { token: readToken } = await newBotToken(reader)

    await asToken(writeToken, async (sql) => {
      expect((await sql`select id from boards`).map(r => r.id)).toEqual([boardId])
      const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'By bot', 1, ${writer}) returning id`
      expect(c).toBeTruthy()
      // Its board's members are visible, as with anyone on the board.
      expect(await sql`select id from users where id = ${owner.id}`).toHaveLength(1)
    })
    await rejectsWith(asToken(writeToken, sql => sql`select app.create_board('Nope')`), '42501')
    await rejectsWith(asToken(writeToken, sql => sql`select app.create_board_bot(${boardId}, 'Child', 'viewer')`), '42501')
    await rejectsWith(asToken(readToken, sql => sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'No', 2, ${reader})`), '42501')
    await asToken(readToken, async (sql) => {
      expect(await sql`select id from cards where board_id = ${boardId}`).not.toHaveLength(0)
    })
  })
})

// Owners limit bots to columns and cards like any other member (0088).
describe('limited bots', () => {
  it('a limited bot only sees and edits what its limits allow, and the limits go with the bot', async () => {
    const bot = await newBot(boardId, 'Limited', 'editor')
    const { token } = await newBotToken(bot)
    const [{ id: hiddenCol }] = await as(owner.id, sql => sql`
      insert into columns (board_id, title, position) values (${boardId}, 'Hidden', 50) returning id`) as any
    const [{ id: readCol }] = await as(owner.id, sql => sql`
      insert into columns (board_id, title, position) values (${boardId}, 'Read only', 51) returning id`) as any
    const [{ id: hiddenCard }] = await as(owner.id, sql => sql`
      insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${hiddenCol}, 'Secret', 1, ${owner.id}) returning id`) as any
    const [{ id: readCard }] = await as(owner.id, sql => sql`
      insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${readCol}, 'Look only', 1, ${owner.id}) returning id`) as any

    // Only owners set limits, also for bots.
    await rejectsWith(as(editor.id, sql => sql`
      insert into board_member_limits (board_id, user_id, default_access) values (${boardId}, ${bot}, 'edit')`), '42501')
    await as(owner.id, async (sql) => {
      await sql`insert into board_member_limits (board_id, user_id, default_access) values (${boardId}, ${bot}, 'edit')`
      await sql`insert into board_member_access (board_id, user_id, column_id, access) values
        (${boardId}, ${bot}, ${hiddenCol}, 'none'), (${boardId}, ${bot}, ${readCol}, 'read')`
    })

    await asToken(token, async (sql) => {
      const cols = (await sql`select id from columns where board_id = ${boardId}`).map(r => r.id)
      expect(cols).toContain(todoId)
      expect(cols).toContain(readCol)
      expect(cols).not.toContain(hiddenCol)
      expect(await sql`select 1 from cards where id = ${hiddenCard}`).toHaveLength(0)
      expect(await sql`select 1 from cards where id = ${readCard}`).toHaveLength(1)
      // RLS filters the update to zero rows on a read-only card.
      expect(await sql`update cards set title = 'Changed' where id = ${readCard} returning id`).toHaveLength(0)
      // No RETURNING: the select policy's limited card list does not see the new row yet.
      await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'Allowed', 9, ${bot})`
      expect(await sql`select 1 from cards where board_id = ${boardId} and title = 'Allowed'`).toHaveLength(1)
    })
    // No new cards in a read-only column; no structure changes while limited.
    await rejectsWith(asToken(token, sql => sql`
      insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${readCol}, 'No', 2, ${bot})`), '42501')
    await rejectsWith(asToken(token, sql => sql`
      insert into columns (board_id, title, position) values (${boardId}, 'Bot column', 60)`), '42501')

    await as(owner.id, sql => sql`select app.delete_board_bot(${bot})`)
    expect(await owner_`select 1 from board_member_limits where user_id = ${bot}`).toHaveLength(0)
    expect(await owner_`select 1 from board_member_access where user_id = ${bot}`).toHaveLength(0)
    await as(owner.id, sql => sql`delete from columns where id in (${hiddenCol}, ${readCol})`)
  })
})

describe('deleting bots', () => {
  it('deleting a bot keeps its work with a null creator and actor and drops its tokens', async () => {
    const bot = await newBot(boardId, 'Temp', 'editor')
    const { token } = await newBotToken(bot)
    const cardId = await asToken(token, async (sql) => {
      const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'Temp work', 3, ${bot}) returning id`
      await sql`insert into card_comments (card_id, board_id, author_id, body) values (${c!.id}, ${boardId}, ${bot}, 'hello')`
      await sql`insert into card_assignees (card_id, board_id, user_id) values (${c!.id}, ${boardId}, ${bot})`
      return c!.id as string
    })
    expect(await owner_`select 1 from card_activity where card_id = ${cardId} and actor_id = ${bot}`).not.toHaveLength(0)

    await as(owner.id, sql => sql`select app.delete_board_bot(${bot})`)
    expect(await owner_`select 1 from users where id = ${bot}`).toHaveLength(0)
    expect(await owner_`select 1 from api_tokens where user_id = ${bot}`).toHaveLength(0)
    expect(await auth`select * from app.resolve_api_token(${sha(token)})`).toHaveLength(0)
    const [card] = await owner_`select created_by from cards where id = ${cardId}`
    expect(card).toEqual({ created_by: null })
    expect(await owner_`select author_id from card_comments where card_id = ${cardId}`).toEqual([{ author_id: null }])
    expect(await owner_`select 1 from card_activity where card_id = ${cardId} and actor_id = ${bot}`).toHaveLength(0)
    expect(await owner_`select 1 from card_assignees where card_id = ${cardId}`).toHaveLength(0)
  })

  it('deleting the board deletes its bots and their tokens', async () => {
    const [{ id: b }] = await as(owner.id, sql => sql`select id from app.create_board('Short-lived')`) as any
    const bot = await newBot(b)
    const { token } = await newBotToken(bot)
    await as(owner.id, sql => sql`delete from boards where id = ${b}`)
    expect(await owner_`select 1 from users where id = ${bot}`).toHaveLength(0)
    expect(await auth`select * from app.resolve_api_token(${sha(token)})`).toHaveLength(0)
  })
})

// 0103_bot_notifications_rls.sql: bots get inbox notifications like people,
// never auto-watch and never get push.
describe('bot notifications', () => {
  async function newCard(title: string) {
    const [c] = await as(editor.id, sql => sql`
      insert into cards (board_id, column_id, title, position, created_by)
      values (${boardId}, ${todoId}, ${title}, 10, ${editor.id}) returning id`)
    return c!.id as string
  }
  const botInbox = (bot: string, cardId: string) => owner_`
    select a.kind from notifications n join card_activity a on a.id = n.activity_id
    where n.user_id = ${bot} and n.card_id = ${cardId} order by n.created_at`

  it('a bot is notified when mentioned or assigned, and gets no push', async () => {
    const bot = await newBot(boardId, 'Agent')
    // A subscription for the bot (bots have no sessions; borrow the owner's) proves push is skipped.
    const [s] = await owner_`insert into user_sessions (user_id) values (${owner.id}) returning id`
    await owner_`insert into push_subscriptions (user_id, session_id, endpoint, p256dh, auth)
      values (${bot}, ${s!.id}, ${`https://push.invalid/${randomUUID()}`}, ${'k'.repeat(87)}, ${'a'.repeat(22)})`
    const cardId = await newCard('Mention the bot')

    await as(editor.id, sql => sql`
      insert into card_comments (card_id, board_id, author_id, body)
      values (${cardId}, ${boardId}, ${editor.id}, ${`please look @[Agent](user:${bot})`})`)
    await as(editor.id, sql => sql`insert into card_assignees (card_id, board_id, user_id) values (${cardId}, ${boardId}, ${bot})`)

    expect((await botInbox(bot, cardId)).map(r => r.kind)).toEqual(['commented', 'assigned'])
    expect(await owner_`
      select 1 from push_messages m join notifications n on n.id = m.notification_id where n.user_id = ${bot}`).toHaveLength(0)
    await owner_`delete from user_sessions where id = ${s!.id}`
  })

  it('a bot does not start watching the cards it creates or comments on', async () => {
    const bot = await newBot(boardId, 'Writer')
    const { token } = await newBotToken(bot)
    const other = await newCard('Someone else\'s card')
    const own = await asToken(token, async (sql) => {
      const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'Bot card', 11, ${bot}) returning id`
      await sql`insert into card_comments (card_id, board_id, author_id, body) values (${other}, ${boardId}, ${bot}, 'done')`
      return c!.id as string
    })
    expect(await owner_`select 1 from card_watchers where user_id = ${bot}`).toHaveLength(0)
    // People still do.
    expect(await owner_`select user_id from card_watchers where card_id = ${other}`).toEqual([{ user_id: editor.id }])

    // So later comments on those cards do not reach the bot; a watch it asks for does.
    await as(editor.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${own}, ${boardId}, ${editor.id}, 'thanks')`)
    expect(await botInbox(bot, own)).toHaveLength(0)
    await asToken(token, sql => sql`insert into card_watchers (card_id, board_id, user_id) values (${own}, ${boardId}, ${bot})`)
    await as(editor.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${own}, ${boardId}, ${editor.id}, 'again')`)
    expect((await botInbox(bot, own)).map(r => r.kind)).toEqual(['commented'])
  })

  it('a bot token reads, marks read and deletes only the bot\'s notifications', async () => {
    const bot = await newBot(boardId, 'Reader')
    const { token } = await newBotToken(bot)
    const cardId = await newCard('Inbox card')
    await as(editor.id, sql => sql`
      insert into card_comments (card_id, board_id, author_id, body)
      values (${cardId}, ${boardId}, ${editor.id}, ${`@[Reader](user:${bot}) and @[Viewer](user:${viewer.id})`})`)

    const seen = await asToken(token, sql => sql`select id, user_id from notifications where card_id = ${cardId}`)
    expect(seen.map(r => r.user_id)).toEqual([bot])
    const read = await asToken(token, sql => sql`update notifications set read_at = now() where card_id = ${cardId} returning id`)
    expect(read).toHaveLength(1)
    expect(await owner_`select 1 from notifications where card_id = ${cardId} and user_id = ${viewer.id} and read_at is null`).toHaveLength(1)
    const gone = await asToken(token, sql => sql`delete from notifications where card_id = ${cardId} returning id`)
    expect(gone).toHaveLength(1)
    expect(await owner_`select 1 from notifications where card_id = ${cardId}`).toHaveLength(1)
  })
})
