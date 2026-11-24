// Per-member access limits (0088_board_member_access_rls.sql): owners limit a
// non-owner to columns and cards with access none | read | edit. Hidden cards
// and their children disappear, read-only cards refuse writes, cards only move
// into editable columns, and limited people cannot change the board's structure.
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
let boardOwner: User, editor: User, viewer: User, other: User
let boardId: string
// open: edit, ro: read, hidden: none (default)
let openCol: string, roCol: string, hiddenCol: string
let openCard: string, roCard: string, hiddenCard: string, pickedCard: string

const card = (col: string, title: string) =>
  as(boardOwner.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by)
    values (${boardId}, ${col}, ${title}, 1, ${boardOwner.id}) returning id`)[0]!.id as string)

const visibleCards = (userId: string) =>
  as(userId, async sql => (await sql`select id from cards where board_id = ${boardId}`).map(r => r.id as string))

beforeAll(async () => {
  ;[boardOwner, editor, viewer, other] = await Promise.all(['owner', 'editor', 'viewer', 'other'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Access board')` as any
    ;[{ id: openCol }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Open', 1) returning id` as any
    ;[{ id: roCol }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Read', 2) returning id` as any
    ;[{ id: hiddenCol }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Hidden', 3) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
    await sql`select app.add_board_member(${boardId}, ${other.email}, 'editor')`
  })
  openCard = await card(openCol, 'Open card')
  roCard = await card(roCol, 'Read card')
  hiddenCard = await card(hiddenCol, 'Hidden card')
  pickedCard = await card(hiddenCol, 'Picked card')
  await as(boardOwner.id, async (sql) => {
    await sql`insert into checklist_items (card_id, board_id, text, position) values (${hiddenCard}, ${boardId}, 'secret', 1)`
    await sql`insert into card_comments (card_id, board_id, author_id, body) values (${hiddenCard}, ${boardId}, ${boardOwner.id}, 'secret')`
    for (const u of [editor, viewer]) {
      await sql`insert into board_member_limits (board_id, user_id) values (${boardId}, ${u.id})`
      await sql`insert into board_member_access (board_id, user_id, column_id, access) values
        (${boardId}, ${u.id}, ${openCol}, 'edit'), (${boardId}, ${u.id}, ${roCol}, 'read')`
      await sql`insert into board_member_access (board_id, user_id, card_id, access) values (${boardId}, ${u.id}, ${pickedCard}, 'edit')`
    }
  })
})

afterAll(async () => {
  await owner`delete from boards where id = ${boardId}`
  await owner`delete from users where id = any(${[boardOwner, editor, viewer, other].map(u => u.id)})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('board member access', () => {
  it('hides cards and columns outside the scope', async () => {
    expect((await visibleCards(editor.id)).sort()).toEqual([openCard, roCard, pickedCard].sort())
    expect((await visibleCards(viewer.id)).sort()).toEqual([openCard, roCard, pickedCard].sort())
    expect(await visibleCards(other.id)).toHaveLength(4)
    expect(await visibleCards(boardOwner.id)).toHaveLength(4)
    // The hidden column shows because of the picked card.
    const cols = await as(editor.id, sql => sql`select id from columns where board_id = ${boardId}`)
    expect(cols.map(r => r.id).sort()).toEqual([openCol, roCol, hiddenCol].sort())
    await owner`delete from board_member_access where card_id = ${pickedCard} and user_id = ${viewer.id}`
    const viewerCols = await as(viewer.id, sql => sql`select id from columns where board_id = ${boardId}`)
    expect(viewerCols.map(r => r.id).sort()).toEqual([openCol, roCol].sort())
    await owner`insert into board_member_access (board_id, user_id, card_id, access) values (${boardId}, ${viewer.id}, ${pickedCard}, 'edit')`
  })

  it('hides the children of hidden cards', async () => {
    const items = await as(editor.id, sql => sql`select id from checklist_items where card_id = ${hiddenCard}`)
    expect(items).toHaveLength(0)
    const comments = await as(editor.id, sql => sql`select id from card_comments where card_id = ${hiddenCard}`)
    expect(comments).toHaveLength(0)
    const activity = await as(editor.id, sql => sql`select card_id from card_activity where board_id = ${boardId}`)
    expect(activity.some(r => r.card_id === hiddenCard)).toBe(false)
    expect(activity.some(r => r.card_id === openCard)).toBe(true)
    const all = await as(other.id, sql => sql`select id from checklist_items where card_id = ${hiddenCard}`)
    expect(all).toHaveLength(1)
  })

  it('edits only cards with edit access', async () => {
    expect((await as(editor.id, sql => sql`update cards set title = 'x' where id = ${openCard}`)).count).toBe(1)
    expect((await as(editor.id, sql => sql`update cards set title = 'x' where id = ${pickedCard}`)).count).toBe(1)
    expect((await as(editor.id, sql => sql`update cards set title = 'x' where id = ${roCard}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`update cards set title = 'x' where id = ${hiddenCard}`)).count).toBe(0)
    // Viewers stay read-only, whatever the entry says.
    expect((await as(viewer.id, sql => sql`update cards set title = 'x' where id = ${openCard}`)).count).toBe(0)
    await rejectsWith(as(editor.id, sql => sql`insert into checklist_items (card_id, board_id, text, position)
      values (${roCard}, ${boardId}, 'x', 1)`), '42501')
    await as(editor.id, sql => sql`insert into checklist_items (card_id, board_id, text, position) values (${openCard}, ${boardId}, 'ok', 1)`)
    await rejectsWith(as(editor.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body)
      values (${roCard}, ${boardId}, ${editor.id}, 'x')`), '42501')
  })

  it('creates cards only in editable columns', async () => {
    const insert = (col: string) => as(editor.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by)
      values (${boardId}, ${col}, 'New', 9, ${editor.id})`)
    await insert(openCol)
    await rejectsWith(insert(roCol), '42501')
    await rejectsWith(insert(hiddenCol), '42501')
  })

  // INSERT ... RETURNING also checks cards_select on the new row (the API's
  // card POST and app.copy_card both read the id back).
  it('reads back a card it creates (insert ... returning, copy_card)', async () => {
    const [row] = await as(editor.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by)
      values (${boardId}, ${openCol}, 'Returned', 10, ${editor.id}) returning id`)
    expect(row!.id).toBeTruthy()
    const template = await as(boardOwner.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by, is_template)
      values (${boardId}, ${openCol}, 'Template', 11, ${boardOwner.id}, true) returning id`)[0]!.id as string)
    const [copy] = await as(editor.id, sql => sql`select app.copy_card(${template}, ${openCol}, false, false) as id`)
    expect(copy!.id).toBeTruthy()
  })

  it('moves cards only into editable columns', async () => {
    await rejectsWith(as(editor.id, sql => sql`update cards set column_id = ${roCol} where id = ${openCard}`), '42501')
    await rejectsWith(as(editor.id, sql => sql`update cards set column_id = ${roCol} where id = ${pickedCard}`), '42501')
    expect((await as(editor.id, sql => sql`update cards set column_id = ${openCol} where id = ${pickedCard}`)).count).toBe(1)
    await rejectsWith(as(editor.id, sql => sql`update cards set column_id = ${hiddenCol} where id = ${pickedCard}`), '42501')
    // Unlimited editors move anywhere.
    expect((await as(other.id, sql => sql`update cards set column_id = ${hiddenCol} where id = ${pickedCard}`)).count).toBe(1)
  })

  it('locks the board structure for limited people', async () => {
    expect((await as(editor.id, sql => sql`select app.can_edit(${boardId}) as ok`))[0]!.ok).toBe(false)
    expect((await as(other.id, sql => sql`select app.can_edit(${boardId}) as ok`))[0]!.ok).toBe(true)
    await rejectsWith(as(editor.id, sql => sql`insert into columns (board_id, title, position) values (${boardId}, 'x', 9)`), '42501')
    expect((await as(editor.id, sql => sql`update columns set title = 'x' where id = ${openCol}`)).count).toBe(0)
  })

  it('trashes and restores only editable cards', async () => {
    const c = await card(openCol, 'Trash')
    const ok = (fn: string, id: string) => as(editor.id, async sql => (await sql`select app.${sql.unsafe(fn)}(${id}) as ok`)[0]!.ok)
    expect(await ok('trash_card', roCard)).toBe(false)
    expect(await ok('trash_card', c)).toBe(true)
    expect(await ok('restore_card', c)).toBe(true)
  })

  it('only owners manage limits, never on owners', async () => {
    await rejectsWith(as(other.id, sql => sql`insert into board_member_limits (board_id, user_id) values (${boardId}, ${other.id})`), '42501')
    await rejectsWith(as(boardOwner.id, sql => sql`insert into board_member_limits (board_id, user_id) values (${boardId}, ${boardOwner.id})`), '42501')
    // People read their own limits only.
    expect(await as(editor.id, sql => sql`select user_id from board_member_limits where board_id = ${boardId}`)).toEqual([{ user_id: editor.id }])
    expect(await as(other.id, sql => sql`select user_id from board_member_limits where board_id = ${boardId}`)).toEqual([])
    expect(await as(boardOwner.id, sql => sql`select user_id from board_member_limits where board_id = ${boardId}`)).toHaveLength(2)
  })

  it('does not notify people about cards they cannot see', async () => {
    await owner`insert into card_watchers (card_id, board_id, user_id) values (${hiddenCard}, ${boardId}, ${other.id})`
    await owner`insert into card_watchers (card_id, board_id, user_id) values (${hiddenCard}, ${boardId}, ${editor.id})`
    await as(boardOwner.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${hiddenCard}, ${boardId}, ${boardOwner.id}, 'ping')`)
    const rows = await owner`select user_id from notifications where card_id = ${hiddenCard}`
    expect(rows.map(r => r.user_id)).toContain(other.id)
    expect(rows.map(r => r.user_id)).not.toContain(editor.id)
    // Nor can they watch it themselves.
    await rejectsWith(as(viewer.id, sql => sql`insert into card_watchers (card_id, board_id, user_id) values (${hiddenCard}, ${boardId}, ${viewer.id})`), '42501')
  })

  it('drops the limits when the person leaves, and an owner role ignores them', async () => {
    await as(boardOwner.id, sql => sql`update board_members set role = 'owner' where board_id = ${boardId} and user_id = ${editor.id}`)
    expect(await visibleCards(editor.id)).toHaveLength((await visibleCards(boardOwner.id)).length)
    await as(boardOwner.id, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${viewer.id}`)
    expect(await owner`select 1 from board_member_limits where board_id = ${boardId} and user_id = ${viewer.id}`).toHaveLength(0)
  })
})
