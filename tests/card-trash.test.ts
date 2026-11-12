// Trash for deleted cards (cards.deleted_at, 0058_card_trash_rls.sql): the
// cards policy hides trashed cards; editors list, restore and purge them
// through app.* functions; app.purge_trash deletes them after 30 days.
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

async function rejectsWith(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name, email_verified_at) values (${`${name}-${randomUUID()}@test.local`}, ${name}, now()) returning id, email`
  return u as { id: string, email: string }
}

type User = { id: string, email: string }
let boardOwner: User, editor: User, viewer: User, outsider: User
let boardId: string
let otherBoardId: string
let columnId: string

const newCard = (title = 'Card', position = 1) =>
  as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, ${title}, ${position}, ${editor.id}) returning id`)[0]!.id as string)

const trash = (userId: string, cardId: string) => as(userId, async sql => (await sql`select app.trash_card(${cardId}) as ok`)[0]!.ok as boolean)
const restore = (userId: string, cardId: string) => as(userId, async sql => (await sql`select app.restore_card(${cardId}) as ok`)[0]!.ok as boolean)
const visible = (userId: string, cardId: string) => as(userId, async sql => (await sql`select id from cards where id = ${cardId}`).length === 1)
const exists = async (cardId: string) => (await owner`select id from cards where id = ${cardId}`).length === 1

beforeAll(async () => {
  ;[boardOwner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Trash board')` as any
    ;[{ id: otherBoardId }] = await sql`select id from app.create_board('Other board')` as any
    ;[{ id: columnId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
})

afterAll(async () => {
  await owner`delete from boards where id = any(${[boardId, otherBoardId]})`
  await owner`delete from users where id = any(${[boardOwner, editor, viewer, outsider].map(u => u.id)})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('card trash', () => {
  it('editors trash cards, which then disappear for everyone', async () => {
    const card = await newCard('Trash me', 7)
    expect(await trash(viewer.id, card)).toBe(false)
    expect(await trash(outsider.id, card)).toBe(false)
    expect(await trash(editor.id, card)).toBe(true)
    expect(await trash(editor.id, card)).toBe(false)
    expect(await visible(editor.id, card)).toBe(false)
    expect(await visible(viewer.id, card)).toBe(false)
    // Updates and deletes find nothing.
    expect((await as(editor.id, sql => sql`update cards set title = 'x' where id = ${card}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`delete from cards where id = ${card}`)).count).toBe(0)
    const [row] = await owner`select deleted_by, position from cards where id = ${card}`
    expect(row).toMatchObject({ deleted_by: editor.id, position: 7 })
  })

  it('editors list the trash, viewers and outsiders may not', async () => {
    const card = await newCard('Listed')
    await trash(boardOwner.id, card)
    const rows = await as(editor.id, sql => sql`select * from app.trashed_cards(${boardId})`)
    expect(rows.find(r => r.id === card)).toMatchObject({ title: 'Listed', column_id: columnId, is_template: false, deleted_by_name: 'owner' })
    await rejectsWith(as(viewer.id, sql => sql`select * from app.trashed_cards(${boardId})`), '42501')
    await rejectsWith(as(outsider.id, sql => sql`select * from app.trashed_cards(${boardId})`), '42501')
  })

  it('cards cannot be trashed or inserted trashed directly', async () => {
    const card = await newCard()
    await rejectsWith(as(editor.id, sql => sql`update cards set deleted_at = now() where id = ${card}`), '42501')
    await rejectsWith(as(editor.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by, deleted_at)
      values (${boardId}, ${columnId}, 'x', 1, ${editor.id}, now())`), '42501')
  })

  it('editors restore cards to their old place', async () => {
    const card = await newCard('Back', 42)
    await trash(editor.id, card)
    expect(await restore(viewer.id, card)).toBe(false)
    expect(await restore(outsider.id, card)).toBe(false)
    expect(await restore(editor.id, card)).toBe(true)
    expect(await restore(editor.id, card)).toBe(false)
    const [row] = await as(viewer.id, sql => sql`select position, column_id, deleted_by from cards where id = ${card}`)
    expect(row).toMatchObject({ position: 42, column_id: columnId, deleted_by: null })
  })

  it('nothing is restored or edited on an archived board', async () => {
    const [card, live] = [await newCard(), await newCard()]
    await trash(editor.id, card)
    await as(boardOwner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    try {
      expect(await restore(boardOwner.id, card)).toBe(false)
      expect(await trash(boardOwner.id, live)).toBe(false)
      await rejectsWith(as(boardOwner.id, sql => sql`select * from app.trashed_cards(${boardId})`), '42501')
    }
    finally {
      await as(boardOwner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
    }
  })

  it('editors delete trashed cards for good, one or all', async () => {
    const [a, b, live] = [await newCard('a'), await newCard('b'), await newCard('live')]
    await trash(editor.id, a)
    await trash(editor.id, b)
    const purge = (userId: string, board: string, card: string) =>
      as(userId, async sql => (await sql`select app.purge_trashed_card(${board}, ${card}) as ok`)[0]!.ok as boolean)
    expect(await purge(viewer.id, boardId, a)).toBe(false)
    expect(await purge(editor.id, otherBoardId, a)).toBe(false)
    // Only trashed cards.
    expect(await purge(editor.id, boardId, live)).toBe(false)
    expect(await purge(editor.id, boardId, a)).toBe(true)
    expect(await exists(a)).toBe(false)

    await rejectsWith(as(viewer.id, sql => sql`select app.empty_trash(${boardId})`), '42501')
    const [{ n }] = await as(editor.id, sql => sql`select app.empty_trash(${boardId}) as n`) as any
    expect(n).toBeGreaterThanOrEqual(1)
    expect(await exists(b)).toBe(false)
    expect(await exists(live)).toBe(true)
  })

  it('app.purge_trash deletes cards trashed more than 30 days ago, kanban_auth only', async () => {
    const [old, recent] = [await newCard('old'), await newCard('recent')]
    await trash(editor.id, old)
    await trash(editor.id, recent)
    await owner`update cards set deleted_at = now() - interval '31 days' where id = ${old}`
    await rejectsWith(as(editor.id, sql => sql`select app.purge_trash(${boardId})`), '42501')
    const [{ n }] = await auth`select app.purge_trash(${boardId}) as n`
    expect(n).toBe(1)
    expect(await exists(old)).toBe(false)
    expect(await exists(recent)).toBe(true)
  })

  it('automations and recurring cards skip trashed cards', async () => {
    const card = await newCard('stale')
    await trash(editor.id, card)
    const open = await owner`select id from app.automation_open_cards(${boardId})`
    expect(open.map(r => r.id)).not.toContain(card)

    const template = await as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by, is_template)
      values (${boardId}, ${columnId}, 'Weekly', 1, ${editor.id}, true) returning id`)[0]!.id as string)
    const [{ id: recurrence }] = await as(editor.id, sql => sql`insert into card_recurrences (template_card_id, board_id, column_id, rule)
      values (${template}, ${boardId}, ${columnId}, 'daily') returning id`) as any
    await trash(editor.id, template)
    await owner`update card_recurrences set next_run_at = now() - interval '1 day' where id = ${recurrence}`
    const before = (await owner`select count(*)::int as n from cards where board_id = ${boardId}`)[0]!.n
    await auth`select * from app.run_due_recurrences()`
    expect((await owner`select count(*)::int as n from cards where board_id = ${boardId}`)[0]!.n).toBe(before)
    const [r] = await owner`select next_run_at from card_recurrences where id = ${recurrence}`
    expect(new Date(r!.next_run_at).getTime()).toBeGreaterThan(Date.now())
    // Hidden with its template.
    expect((await as(editor.id, sql => sql`select r.id from card_recurrences r join cards c on c.id = r.template_card_id where r.id = ${recurrence}`)).length).toBe(0)
  })
})
