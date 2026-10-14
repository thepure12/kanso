// RLS and trigger tests for column rules. Same setup as rls.test.ts.
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
let boardId: string
let todoId: string
let doneId: string
let doneTagId: string
let otherBoardId: string
let otherTagId: string
let reviewId: string

const assigneesOf = (cardId: string) =>
  as(owner.id, async sql => (await sql`select user_id from card_assignees where card_id = ${cardId} order by user_id`).map(r => r.user_id as string))

const dueOf = (cardId: string) =>
  as(owner.id, async sql => (await sql`select due_date::text as d from cards where id = ${cardId}`)[0]!.d as string | null)

const tagsOf = (cardId: string) =>
  as(owner.id, async sql => (await sql`select tag_id from card_tags where card_id = ${cardId}`).map(r => r.tag_id))

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser))
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Rules board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    ;[{ id: reviewId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Review', 3) returning id` as any
    ;[{ id: doneTagId }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'done', '#22c55e') returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
  await as(outsider.id, async (sql) => {
    ;[{ id: otherBoardId }] = await sql`select id from app.create_board('Other board')` as any
    ;[{ id: otherTagId }] = await sql`insert into tags (board_id, name, color) values (${otherBoardId}, 'other', '#000000') returning id` as any
  })
})

afterAll(async () => {
  await as(owner.id, sql => sql`delete from boards where id = ${boardId}`)
  await as(outsider.id, sql => sql`delete from boards where id = ${otherBoardId}`)
  await Promise.all([app.end(), auth.end()])
})

describe('column rules', () => {
  it('editor can add rules; viewer can read but not add or delete', async () => {
    await as(editor.id, sql => sql`insert into column_rules (board_id, column_id, kind, tag_id) values (${boardId}, ${doneId}, 'apply_tag', ${doneTagId})`)
    await as(viewer.id, async (sql) => {
      expect(await sql`select id from column_rules where column_id = ${doneId}`).toHaveLength(1)
      expect((await sql`delete from column_rules where column_id = ${doneId}`).count).toBe(0)
    })
    await rejectsWith(as(viewer.id, sql => sql`insert into column_rules (board_id, column_id, kind, tag_id) values (${boardId}, ${todoId}, 'apply_tag', ${doneTagId})`), '42501')
  })

  it('non-member sees nothing and cannot add', async () => {
    expect(await as(outsider.id, sql => sql`select id from column_rules where board_id = ${boardId}`)).toHaveLength(0)
    await rejectsWith(as(outsider.id, sql => sql`insert into column_rules (board_id, column_id, kind, tag_id) values (${boardId}, ${todoId}, 'apply_tag', ${doneTagId})`), '42501')
  })

  it('rule cannot use another board\'s tag, and apply_tag needs a tag', async () => {
    await rejectsWith(as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind, tag_id) values (${boardId}, ${todoId}, 'apply_tag', ${otherTagId})`), '23503')
    await rejectsWith(as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind) values (${boardId}, ${todoId}, 'apply_tag')`), '23514')
  })

  it('applies the tag when a card is created in the column', async () => {
    const [card] = await as(editor.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${doneId}, 'Born done', 1, ${editor.id}) returning id`)
    expect(await tagsOf(card!.id)).toEqual([doneTagId])
  })

  it('applies the tag when a card moves into the column, not on reorder or elsewhere', async () => {
    const [card] = await as(editor.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'Moving', 1, ${editor.id}) returning id`)
    expect(await tagsOf(card!.id)).toEqual([])
    await as(editor.id, sql => sql`update cards set column_id = ${doneId} where id = ${card!.id}`)
    expect(await tagsOf(card!.id)).toEqual([doneTagId])

    // Removed by hand, then reordered within the column: not re-applied.
    await as(editor.id, sql => sql`delete from card_tags where card_id = ${card!.id}`)
    await as(editor.id, sql => sql`update cards set column_id = ${doneId}, position = 5 where id = ${card!.id}`)
    expect(await tagsOf(card!.id)).toEqual([])

    // Moving a card that already has the tag is fine.
    await as(editor.id, sql => sql`update cards set column_id = ${todoId} where id = ${card!.id}`)
    await as(editor.id, sql => sql`insert into card_tags (card_id, tag_id, board_id) values (${card!.id}, ${doneTagId}, ${boardId})`)
    await as(editor.id, sql => sql`update cards set column_id = ${doneId} where id = ${card!.id}`)
    expect(await tagsOf(card!.id)).toEqual([doneTagId])
  })

  it('deleting the tag deletes the rule', async () => {
    await as(owner.id, sql => sql`delete from tags where id = ${doneTagId}`)
    expect(await as(owner.id, sql => sql`select id from column_rules where column_id = ${doneId}`)).toHaveLength(0)
  })
})

describe('assign_to rules', () => {
  const addAssign = (by: string, userId: string, columnId = reviewId) =>
    as(by, sql => sql`insert into column_rules (board_id, column_id, kind, user_id) values (${boardId}, ${columnId}, 'assign_to', ${userId})`)
  const newCard = (columnId: string) =>
    as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'Card', 1, ${editor.id}) returning id`)[0]!.id as string)

  it('needs a user, no tag, and the user must be a board member', async () => {
    await rejectsWith(as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind) values (${boardId}, ${reviewId}, 'assign_to')`), '23514')
    await rejectsWith(as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind, user_id, tag_id) values (${boardId}, ${reviewId}, 'assign_to', ${viewer.id}, ${doneTagId})`), '23514')
    await rejectsWith(as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind, tag_id, user_id) values (${boardId}, ${reviewId}, 'apply_tag', ${doneTagId}, ${viewer.id})`), '23514')
    await rejectsWith(addAssign(owner.id, outsider.id), '42501')
    await rejectsWith(addAssign(viewer.id, viewer.id), '42501')
  })

  it('allows several assign rules per column, but not the same person twice', async () => {
    await addAssign(editor.id, viewer.id)
    await addAssign(editor.id, owner.id)
    await rejectsWith(addAssign(owner.id, owner.id), '23505')
  })

  it('adds assignees on create and on move in, keeping existing ones, not on reorder', async () => {
    expect(await assigneesOf(await newCard(reviewId))).toEqual([owner.id, viewer.id].sort())

    const id = await newCard(todoId)
    expect(await assigneesOf(id)).toEqual([])
    await as(editor.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${editor.id}, ${boardId})`)
    await as(editor.id, sql => sql`update cards set column_id = ${reviewId} where id = ${id}`)
    expect(await assigneesOf(id)).toEqual([owner.id, viewer.id, editor.id].sort())

    await as(editor.id, sql => sql`delete from card_assignees where card_id = ${id} and user_id = ${viewer.id}`)
    await as(editor.id, sql => sql`update cards set column_id = ${reviewId}, position = 9 where id = ${id}`)
    expect(await assigneesOf(id)).toEqual([owner.id, editor.id].sort())
  })

  it('is skipped once the user loses access, without blocking the move', async () => {
    const helper = await createUser('helper')
    const [{ id: columnId }] = await as(owner.id, async (sql) => {
      await sql`select app.add_board_member(${boardId}, ${helper.email}, 'viewer')`
      return sql`insert into columns (board_id, title, position) values (${boardId}, 'QA', 4) returning id`
    }) as any
    await addAssign(owner.id, helper.id, columnId)
    await as(owner.id, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${helper.id}`)

    const id = await newCard(todoId)
    await as(editor.id, sql => sql`update cards set column_id = ${columnId} where id = ${id}`)
    expect(await assigneesOf(id)).toEqual([])
  })
})

describe('remove_tag and set_due rules', () => {
  let tagId: string
  let shipId: string
  beforeAll(async () => {
    await as(owner.id, async (sql) => {
      ;[{ id: tagId }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'blocked', '#ef4444') returning id` as any
      ;[{ id: shipId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Ship', 5) returning id` as any
    })
  })

  it('remove_tag needs a tag; set_due needs 0-365 days and only one per column', async () => {
    await rejectsWith(as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind) values (${boardId}, ${shipId}, 'remove_tag')`), '23514')
    await rejectsWith(as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind, due_days) values (${boardId}, ${shipId}, 'set_due', 400)`), '23514')
    await rejectsWith(as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind, due_days, tag_id) values (${boardId}, ${shipId}, 'set_due', 3, ${tagId})`), '23514')
    await as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind, due_days) values (${boardId}, ${shipId}, 'set_due', 3)`)
    await rejectsWith(as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind, due_days) values (${boardId}, ${shipId}, 'set_due', 5)`), '23505')
    await as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind, tag_id) values (${boardId}, ${shipId}, 'remove_tag', ${tagId})`)
  })

  it('removes the tag and sets the due date when a card moves in', async () => {
    const id = await as(editor.id, async (sql) => {
      const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'Blocked', 1, ${editor.id}) returning id`
      await sql`insert into card_tags (card_id, tag_id, board_id) values (${c!.id}, ${tagId}, ${boardId})`
      return c!.id as string
    })
    expect(await tagsOf(id)).toEqual([tagId])
    expect(await dueOf(id)).toBeNull()
    await as(editor.id, sql => sql`update cards set column_id = ${shipId} where id = ${id}`)
    expect(await tagsOf(id)).toEqual([])
    const [{ d }] = await as(owner.id, sql => sql`select (current_date + 3)::text as d`) as any
    expect(await dueOf(id)).toBe(d)
  })
})
