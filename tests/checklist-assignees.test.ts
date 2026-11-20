// Checklist item assignees and due dates (0097/0098): only people who can
// see the card can be assigned, assigning logs `checklist_assigned` and
// notifies only the assignee; viewers cannot change items.
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
let boardOwner: User, editor: User, viewer: User, watcher: User, limited: User, outsider: User
let boardId: string
let todoId: string
let hiddenId: string

const newCard = (columnId = todoId) =>
  as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'Card', 1, ${editor.id}) returning id`)[0]!.id as string)

const newItem = (cardId: string, assignee: string | null = null) =>
  as(editor.id, async sql => (await sql`insert into checklist_items (card_id, board_id, text, position, assignee_id) values (${cardId}, ${boardId}, 'Item', 1, ${assignee}) returning id`)[0]!.id as string)

const setItem = (userId: string, itemId: string, assignee: string | null, due: string | null = null) =>
  as(userId, sql => sql`update checklist_items set assignee_id = ${assignee}, due_date = ${due} where id = ${itemId} returning id`)

const activity = (cardId: string) => owner`select kind, data from card_activity where card_id = ${cardId} and kind = 'checklist_assigned' order by created_at`
const notified = async (cardId: string) =>
  (await owner`select n.user_id from notifications n join card_activity a on a.id = n.activity_id where n.card_id = ${cardId} and a.kind = 'checklist_assigned'`).map(r => r.user_id as string)

beforeAll(async () => {
  ;[boardOwner, editor, viewer, watcher, limited, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'watcher', 'limited', 'outsider'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Checklist board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: hiddenId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Hidden', 2) returning id` as any
    for (const [u, role] of [[editor, 'editor'], [viewer, 'viewer'], [watcher, 'viewer'], [limited, 'viewer']] as const) {
      await sql`select app.add_board_member(${boardId}, ${u.email}, ${role})`
    }
    await sql`insert into board_member_limits (board_id, user_id) values (${boardId}, ${limited.id})`
    await sql`insert into board_member_access (board_id, user_id, column_id, access) values (${boardId}, ${limited.id}, ${todoId}, 'read')`
  })
})

afterAll(async () => {
  await owner`delete from boards where id = ${boardId}`
  await owner`delete from users where id = any(${[boardOwner, editor, viewer, watcher, limited, outsider].map(u => u.id)})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('checklist item assignees', () => {
  it('editors assign members; only the assignee is notified', async () => {
    const card = await newCard()
    await as(watcher.id, sql => sql`insert into card_watchers (card_id, board_id, user_id) values (${card}, ${boardId}, ${watcher.id})`)
    const item = await newItem(card)
    expect(await setItem(editor.id, item, viewer.id, '2026-12-01')).toHaveLength(1)
    // Unchanged assignee (only the date changes): nothing new.
    expect(await setItem(editor.id, item, viewer.id, '2026-12-02')).toHaveLength(1)
    expect((await activity(card)).map(a => a.data)).toEqual([{ user: 'viewer', user_id: viewer.id, item: 'Item' }])
    expect(await notified(card)).toEqual([viewer.id])

    const [row] = await owner`select assignee_id, due_date::text as due from checklist_items where id = ${item}`
    expect(row).toEqual({ assignee_id: viewer.id, due: '2026-12-02' })
  })

  it('logs on insert with an assignee, never notifies the actor', async () => {
    const card = await newCard()
    await newItem(card, editor.id)
    expect(await activity(card)).toHaveLength(1)
    expect(await notified(card)).toEqual([])
  })

  it('refuses people who cannot see the card', async () => {
    const card = await newCard()
    const item = await newItem(card)
    await expect(setItem(editor.id, item, outsider.id)).rejects.toMatchObject({ code: '42501' })
    await expect(setItem(editor.id, item, randomUUID())).rejects.toMatchObject({ code: '42501' })
    const hidden = await newItem(await newCard(hiddenId))
    await expect(setItem(editor.id, hidden, limited.id)).rejects.toMatchObject({ code: '42501' })
    // Limited to read on Todo: still assignable there.
    expect(await setItem(editor.id, item, limited.id)).toHaveLength(1)
  })

  it('viewers cannot assign or date items', async () => {
    const item = await newItem(await newCard())
    expect(await setItem(viewer.id, item, viewer.id, '2026-12-01')).toHaveLength(0)
  })

  it('respects the assigned notification setting', async () => {
    await auth`update users set notification_prefs = '{"assigned": {"inbox": false}}' where id = ${watcher.id}`
    const card = await newCard()
    await setItem(editor.id, await newItem(card), watcher.id)
    expect(await notified(card)).toEqual([])
    await auth`update users set notification_prefs = '{}' where id = ${watcher.id}`
  })

  it('clears the assignee when the user is deleted', async () => {
    const temp = await createUser('temp')
    await as(boardOwner.id, sql => sql`select app.add_board_member(${boardId}, ${temp.email}, 'viewer')`)
    const item = await newItem(await newCard(), temp.id)
    await owner`delete from users where id = ${temp.id}`
    const [row] = await owner`select assignee_id from checklist_items where id = ${item}`
    expect(row!.assignee_id).toBeNull()
  })
})
