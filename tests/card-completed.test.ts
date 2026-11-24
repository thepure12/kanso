// Completed cards (cards.completed_at, 0134/0135): who may mark them, the
// activity, the template check and the board rule event card_completed.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name, email_verified_at) values (${`${name}-${randomUUID()}@test.local`}, ${name}, now()) returning id, email`
  return u as { id: string, email: string }
}

type User = { id: string, email: string }
let boardOwner: User, editor: User, viewer: User
let boardId: string, todoId: string, doneId: string

const newCard = (title = 'Card') =>
  as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, ${title}, 1, ${editor.id}) returning id`)[0]!.id as string)

const complete = (userId: string, cardId: string, done: boolean) =>
  as(userId, sql => sql`update cards set completed_at = ${done ? sql`now()` : null} where id = ${cardId} returning id`)

const activity = (cardId: string) => owner`select kind, actor_id from card_activity where card_id = ${cardId} order by created_at`
const card = async (id: string) => (await owner`select column_id, completed_at, priority from cards where id = ${id}`)[0]!

beforeAll(async () => {
  ;[boardOwner, editor, viewer] = await Promise.all(['owner', 'editor', 'viewer'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Completed board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
})

afterAll(async () => {
  await owner`delete from boards where id = ${boardId}`
  await owner`delete from users where id = any(${[boardOwner, editor, viewer].map(u => u.id)})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('completing cards', () => {
  it('editors complete and reopen cards in place, viewers cannot; both are logged', async () => {
    const id = await newCard()
    expect(await complete(viewer.id, id, true)).toHaveLength(0)
    expect(await complete(editor.id, id, true)).toHaveLength(1)
    const c = await card(id)
    expect(c.completed_at).not.toBeNull()
    expect(c.column_id).toBe(todoId)
    expect(await complete(editor.id, id, false)).toHaveLength(1)
    expect((await activity(id)).map(a => a.kind)).toEqual(['created', 'completed', 'reopened'])
  })

  it('refuses templates', async () => {
    const tpl = await as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, is_template, created_by) values (${boardId}, ${todoId}, 'Tpl', 1, true, ${editor.id}) returning id`)[0]!.id as string)
    await expect(complete(editor.id, tpl, true)).rejects.toMatchObject({ code: '23514', constraint_name: 'cards_completed_not_template' })
  })
})

describe('board rule card_completed', () => {
  let ruleId: string
  beforeAll(async () => {
    ;[{ id: ruleId }] = await as(editor.id, sql => sql`insert into board_rules (board_id, event, move_column_id, set_priority, created_by)
      values (${boardId}, 'card_completed', ${doneId}, 'low', ${editor.id}) returning id`) as any
  })
  afterAll(() => owner`delete from board_rules where id = ${ruleId}`)

  it('runs when a card is marked complete', async () => {
    const id = await newCard()
    await complete(editor.id, id, true)
    const c = await card(id)
    expect(c.column_id).toBe(doneId)
    expect(c.priority).toBe('low')
  })

  it('does not run when the card is reopened in the same transaction, nor on reopening', async () => {
    const id = await newCard()
    await as(editor.id, async (sql) => {
      await sql`update cards set completed_at = now() where id = ${id}`
      await sql`update cards set completed_at = null where id = ${id}`
    })
    expect((await card(id)).column_id).toBe(todoId)
    await owner`update cards set completed_at = now() where id = ${id}`
    await as(editor.id, sql => sql`update cards set column_id = ${todoId}, priority = null where id = ${id}`)
    await complete(editor.id, id, false)
    const c = await card(id)
    expect(c.column_id).toBe(todoId)
    expect(c.priority).toBeNull()
  })
})
