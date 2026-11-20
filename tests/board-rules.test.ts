// Event-triggered board rules (board_rules, 0096_board_rules_rls.sql): policies,
// the events that trigger them, conditions, actions, and that a rule's own
// changes trigger no rules. Rules run when the transaction commits.
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
let boardOwner: User, editor: User, viewer: User, outsider: User
let boardId: string
let todoId: string, doingId: string, doneId: string
let bugId: string, urgentTagId: string
const boards: string[] = []

const newCard = (columnId = todoId, extra: { tagId?: string, due?: string } = {}) =>
  as(editor.id, async (sql) => {
    const [{ id }] = await sql`insert into cards (board_id, column_id, title, position, created_by, due_date)
      values (${boardId}, ${columnId}, 'Card', 1, ${editor.id}, ${extra.due ?? null}) returning id` as any
    if (extra.tagId) await sql`insert into card_tags (card_id, tag_id, board_id) values (${id}, ${extra.tagId}, ${boardId})`
    return id as string
  })

type Rule = Partial<Record<'event_tag_id' | 'event_user_id' | 'cond_tag_id' | 'cond_priority' | 'cond_column_id' | 'cond_assignee_id'
  | 'move_column_id' | 'add_tag_id' | 'remove_tag_id' | 'assign_user_id' | 'set_priority', string>> & { set_due_days?: number, archive?: boolean }

const addRule = (userId: string, event: string, rule: Rule) =>
  as(userId, async sql => (await sql`insert into board_rules ${sql({
    board_id: boardId, event, created_by: userId,
    event_tag_id: null, event_user_id: null, cond_tag_id: null, cond_priority: null, cond_column_id: null, cond_assignee_id: null,
    move_column_id: null, add_tag_id: null, remove_tag_id: null, assign_user_id: null, set_priority: null, set_due_days: null, archive: false,
    ...rule,
  })} returning id`)[0]!.id as string)

const card = async (id: string) => (await owner`select column_id, priority, due_date::text as due, archived_at,
  (select array_agg(tag_id) from card_tags where card_id = c.id) as tags,
  (select array_agg(user_id) from card_assignees where card_id = c.id) as assignees
  from cards c where id = ${id}`)[0]!

beforeAll(async () => {
  ;[boardOwner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Rules board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doingId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Doing', 2) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 3) returning id` as any
    ;[{ id: bugId }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'bug', '#ff0000') returning id` as any
    ;[{ id: urgentTagId }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'urgent', '#ff8800') returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
  boards.push(boardId)
})

afterEach(async () => {
  await owner`delete from board_rules where board_id = ${boardId}`
})

afterAll(async () => {
  for (const b of boards) await owner`delete from boards where id = ${b}`
  await owner`delete from users where id = any(${[boardOwner, editor, viewer, outsider].map(u => u.id)})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('board rules', () => {
  it('editors manage them, viewers read, outsiders see nothing', async () => {
    await rejectsWith(addRule(viewer.id, 'card_created', { set_priority: 'high' }), '42501')
    const id = await addRule(editor.id, 'card_created', { set_priority: 'high' })
    expect((await as(viewer.id, sql => sql`select id from board_rules where id = ${id}`)).length).toBe(1)
    expect((await as(outsider.id, sql => sql`select id from board_rules where id = ${id}`)).length).toBe(0)
    expect((await as(viewer.id, sql => sql`update board_rules set active = false where id = ${id}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`update board_rules set active = false where id = ${id}`)).count).toBe(1)
    // created_by must be the caller.
    await rejectsWith(as(editor.id, sql => sql`insert into board_rules (board_id, event, set_priority, created_by)
      values (${boardId}, 'card_created', 'high', ${boardOwner.id})`), '42501')
    // Users named by a rule must be on the board.
    await rejectsWith(addRule(editor.id, 'card_created', { assign_user_id: outsider.id }), '42501')
    expect((await as(viewer.id, sql => sql`delete from board_rules where id = ${id}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`delete from board_rules where id = ${id}`)).count).toBe(1)
  })

  it('checks the fields', async () => {
    // No action.
    await rejectsWith(addRule(editor.id, 'card_created', {}), '23514')
    // Event tag only for tag_added.
    await rejectsWith(addRule(editor.id, 'card_created', { event_tag_id: bugId, set_priority: 'high' }), '23514')
    await rejectsWith(addRule(editor.id, 'card_created', { add_tag_id: bugId, remove_tag_id: bugId }), '23514')
    await rejectsWith(addRule(editor.id, 'card_created', { set_due_days: 400 }), '23514')
    // A tag of another board.
    const other = await as(boardOwner.id, async sql => (await sql`select id from app.create_board('Other')`)[0]!.id as string)
    boards.push(other)
    const otherTag = await as(boardOwner.id, async sql => (await sql`insert into tags (board_id, name, color) values (${other}, 'x', '#000000') returning id`)[0]!.id as string)
    await rejectsWith(addRule(editor.id, 'card_created', { add_tag_id: otherTag }), '23503')
  })

  it('card_created runs at commit, so conditions see the tags added in the same request', async () => {
    await addRule(editor.id, 'card_created', { cond_tag_id: bugId, set_priority: 'urgent', assign_user_id: boardOwner.id })
    const plain = await newCard()
    const bug = await newCard(todoId, { tagId: bugId })
    expect((await card(plain)).priority).toBeNull()
    const c = await card(bug)
    expect(c.priority).toBe('urgent')
    expect(c.assignees).toEqual([boardOwner.id])
    // Logged as an automation, without actor.
    const [act] = await owner`select actor_id, data from card_activity where card_id = ${bug} and kind = 'priority'`
    expect(act).toMatchObject({ actor_id: null, data: { automation: true } })
  })

  it('tag_added with a given tag, condition on the column, moves the card', async () => {
    await addRule(editor.id, 'tag_added', { event_tag_id: urgentTagId, cond_column_id: todoId, move_column_id: doingId })
    const a = await newCard()
    const b = await newCard(doneId)
    await as(editor.id, sql => sql`insert into card_tags (card_id, tag_id, board_id) values (${a}, ${bugId}, ${boardId})`)
    expect((await card(a)).column_id).toBe(todoId)
    await as(editor.id, sql => sql`insert into card_tags (card_id, tag_id, board_id) values (${a}, ${urgentTagId}, ${boardId}), (${b}, ${urgentTagId}, ${boardId})`)
    expect((await card(a)).column_id).toBe(doingId)
    expect((await card(b)).column_id).toBe(doneId)
  })

  it('assigned, due_set, commented and card_moved', async () => {
    await addRule(editor.id, 'assigned', { event_user_id: viewer.id, add_tag_id: bugId })
    await addRule(editor.id, 'due_set', { cond_priority: 'high', add_tag_id: urgentTagId })
    await addRule(editor.id, 'commented', { cond_column_id: doneId, move_column_id: doingId })
    await addRule(editor.id, 'card_moved', { cond_column_id: doneId, remove_tag_id: urgentTagId })
    const id = await newCard()

    await as(editor.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${editor.id}, ${boardId})`)
    expect((await card(id)).tags).toBeNull()
    await as(editor.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${viewer.id}, ${boardId})`)
    expect((await card(id)).tags).toEqual([bugId])

    await as(editor.id, sql => sql`update cards set due_date = '2030-01-01' where id = ${id}`)
    expect((await card(id)).tags).toEqual([bugId])
    await as(editor.id, sql => sql`update cards set priority = 'high', due_date = '2030-01-02' where id = ${id}`)
    expect((await card(id)).tags).toHaveLength(2)

    await as(editor.id, sql => sql`update cards set column_id = ${doneId} where id = ${id}`)
    expect((await card(id)).tags).toEqual([bugId])

    await as(editor.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${editor.id}, 'hi')`)
    expect((await card(id)).column_id).toBe(doingId)
  })

  it('checklist_completed fires once every item is done', async () => {
    await addRule(editor.id, 'checklist_completed', { move_column_id: doneId, set_due_days: 0 })
    const id = await newCard()
    const items = await as(editor.id, sql => sql`insert into checklist_items (card_id, board_id, text, position)
      values (${id}, ${boardId}, 'a', 1), (${id}, ${boardId}, 'b', 2) returning id`)
    await as(editor.id, sql => sql`update checklist_items set done = true where id = ${items[0]!.id}`)
    expect((await card(id)).column_id).toBe(todoId)
    await as(editor.id, sql => sql`update checklist_items set done = true where id = ${items[1]!.id}`)
    const c = await card(id)
    expect(c.column_id).toBe(doneId)
    expect(c.due).toBe((await owner`select current_date::text as d`)[0]!.d)
  })

  it('a rule\'s own changes trigger no rules', async () => {
    // A adds bug on creation; B (tag_added bug) would archive: it must not run off A's change.
    await addRule(editor.id, 'card_created', { add_tag_id: bugId })
    await addRule(editor.id, 'tag_added', { event_tag_id: bugId, archive: true })
    const id = await newCard()
    const c = await card(id)
    expect(c.tags).toEqual([bugId])
    expect(c.archived_at).toBeNull()
  })

  it('inactive rules, templates and archived boards do nothing', async () => {
    const rule = await addRule(editor.id, 'card_created', { set_priority: 'low' })
    await as(editor.id, sql => sql`update board_rules set active = false where id = ${rule}`)
    expect((await card(await newCard())).priority).toBeNull()
    await as(editor.id, sql => sql`update board_rules set active = true where id = ${rule}`)
    const template = await as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by, is_template)
      values (${boardId}, ${todoId}, 'T', 1, ${editor.id}, true) returning id`)[0]!.id as string)
    expect((await card(template)).priority).toBeNull()
    expect((await owner`select count(*)::int as n from board_rule_events where board_id = ${boardId}`)[0]!.n).toBe(0)
  })

  it('set_due pulls a later start date back', async () => {
    await addRule(editor.id, 'card_moved', { set_due_days: 0 })
    const id = await newCard()
    await as(editor.id, sql => sql`update cards set start_date = current_date + 10, due_date = current_date + 20 where id = ${id}`)
    await as(editor.id, sql => sql`update cards set column_id = ${doingId} where id = ${id}`)
    const [c] = await owner`select start_date = current_date as start_today, due_date = current_date as due_today from cards where id = ${id}`
    expect(c).toEqual({ start_today: true, due_today: true })
  })

  it('deleting a tag the rule names deletes the rule', async () => {
    const tag = await as(editor.id, async sql => (await sql`insert into tags (board_id, name, color) values (${boardId}, 'temp', '#00ff00') returning id`)[0]!.id as string)
    const rule = await addRule(editor.id, 'card_created', { add_tag_id: tag })
    await as(editor.id, sql => sql`delete from tags where id = ${tag}`)
    expect((await owner`select id from board_rules where id = ${rule}`).length).toBe(0)
  })
})
