// Agent rules (board_agent_rules, 0130_board_agent_rules_rls.sql): who reads and
// manages them, which bots a rule may name, checks, and cascades.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

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
  const [u] = await auth`insert into users (email, name, email_verified_at) values (${`${name}-${randomUUID()}@test.local`}, ${name}, now()) returning id, email`
  return u as { id: string, email: string }
}

type User = { id: string, email: string }
let boardOwner: User, editor: User, viewer: User, limited: User, outsider: User
let boardId: string, otherBoardId: string
let todoId: string, doneId: string, bugId: string
let botId: string, limitedBotId: string, otherBotId: string

const addRule = (userId: string, extra: Record<string, unknown> = {}) =>
  as(userId, async sql => (await sql`insert into board_agent_rules ${sql({
    board_id: boardId, name: 'Triage', bot_id: botId, event: 'card_moved', column_id: todoId, tag_id: null,
    instructions: 'Look at the card.', move_column_id: doneId, comment: 'failure', created_by: userId, ...extra,
  } as Record<string, any>)} returning id`)[0]!.id as string)

beforeAll(async () => {
  ;[boardOwner, editor, viewer, limited, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'limited', 'outsider'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Agent rules board')` as any
    ;[{ id: otherBoardId }] = await sql`select id from app.create_board('Other board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    ;[{ id: bugId }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'bug', '#ff0000') returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
    await sql`select app.add_board_member(${boardId}, ${limited.email}, 'editor')`
    ;[{ id: botId }] = await sql`select app.create_board_bot(${boardId}, 'Claude', 'editor') as id` as any
    ;[{ id: limitedBotId }] = await sql`select app.create_board_bot(${boardId}, 'Limited bot', 'editor') as id` as any
    ;[{ id: otherBotId }] = await sql`select app.create_board_bot(${otherBoardId}, 'Elsewhere', 'editor') as id` as any
    await sql`insert into board_member_limits (board_id, user_id) values (${boardId}, ${limited.id})`
    await sql`insert into board_member_limits (board_id, user_id) values (${boardId}, ${limitedBotId})`
  })
})

afterEach(async () => {
  await owner`delete from board_agent_rules where board_id = ${boardId}`
})

afterAll(async () => {
  await owner`delete from boards where id = any(${[boardId, otherBoardId]})`
  await owner`delete from users where id = any(${[boardOwner, editor, viewer, limited, outsider].map(u => u.id)})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('agent rules', () => {
  it('editors manage them, viewers read, outsiders see nothing', async () => {
    await rejectsWith(addRule(viewer.id), '42501')
    await rejectsWith(addRule(limited.id), '42501')
    const id = await addRule(editor.id)
    expect((await as(viewer.id, sql => sql`select id from board_agent_rules where id = ${id}`)).length).toBe(1)
    expect((await as(outsider.id, sql => sql`select id from board_agent_rules where id = ${id}`)).length).toBe(0)
    expect((await as(viewer.id, sql => sql`update board_agent_rules set active = false where id = ${id}`)).count).toBe(0)
    expect((await as(viewer.id, sql => sql`delete from board_agent_rules where id = ${id}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`update board_agent_rules set active = false, instructions = 'Other' where id = ${id}`)).count).toBe(1)
    // created_by and board_id are fixed.
    await rejectsWith(as(editor.id, sql => sql`update board_agent_rules set board_id = ${otherBoardId} where id = ${id}`), '42501')
    await rejectsWith(addRule(editor.id, { created_by: boardOwner.id }), '42501')
    expect((await as(editor.id, sql => sql`delete from board_agent_rules where id = ${id}`)).count).toBe(1)
  })

  it('the bot reads its rules, a limited member and a limited bot only their own', async () => {
    const mine = await addRule(editor.id)
    const theirs = await addRule(editor.id, { bot_id: limitedBotId })
    expect((await as(botId, sql => sql`select id from board_agent_rules`)).map(r => r.id).sort()).toEqual([mine, theirs].sort())
    expect(await as(limited.id, sql => sql`select id from board_agent_rules`)).toEqual([])
    expect((await as(limitedBotId, sql => sql`select id from board_agent_rules`)).map(r => r.id)).toEqual([theirs])
  })

  it('names only bots with access to the board', async () => {
    await rejectsWith(addRule(editor.id, { bot_id: editor.id }), '42501')
    await rejectsWith(addRule(editor.id, { bot_id: otherBotId }), '42501')
    const id = await addRule(editor.id)
    await rejectsWith(as(editor.id, sql => sql`update board_agent_rules set bot_id = ${otherBotId} where id = ${id}`), '42501')
  })

  it('checks the fields', async () => {
    await rejectsWith(addRule(editor.id, { name: '  ' }), '23514')
    await rejectsWith(addRule(editor.id, { instructions: '' }), '23514')
    await rejectsWith(addRule(editor.id, { comment: 'sometimes' }), '23514')
    await rejectsWith(addRule(editor.id, { event: 'commented' }), '22P02')
    const [{ id: foreignColumn }] = await owner`insert into columns (board_id, title, position) values (${otherBoardId}, 'X', 1) returning id`
    await rejectsWith(addRule(editor.id, { move_column_id: foreignColumn }), '23503')
  })

  it('goes with its bot, column or tag', async () => {
    const byTag = await addRule(editor.id, { event: 'tag_added', column_id: null, tag_id: bugId })
    const byColumn = await addRule(editor.id)
    await owner`delete from tags where id = ${bugId}`
    expect(await owner`select id from board_agent_rules where id = ${byTag}`).toEqual([])
    await owner`delete from columns where id = ${doneId}`
    expect(await owner`select id from board_agent_rules where id = ${byColumn}`).toEqual([])
    ;[{ id: doneId }] = await owner`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    const byBot = await addRule(editor.id)
    await as(boardOwner.id, sql => sql`select app.delete_board_bot(${botId})`)
    expect(await owner`select id from board_agent_rules where id = ${byBot}`).toEqual([])
    ;[{ id: botId }] = await as(boardOwner.id, sql => sql`select app.create_board_bot(${boardId}, 'Claude', 'editor') as id`) as any
  })
})
