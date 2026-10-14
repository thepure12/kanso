// Card templates (app.copy_card) and recurring cards (card_recurrences,
// app.recurrence_next, app.run_due_recurrences). Same setup as
// card-schedule-time.test.ts, plus the owner role to move run dates back.
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
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  return u as { id: string, email: string }
}

type User = { id: string, email: string }
let boardOwner: User, editor: User, viewer: User, outsider: User
let boardId: string
let todoId: string
let doneId: string
let tagA: string
let tagB: string
let fieldId: string
const boards: string[] = []

const newCard = (title = 'Card', columnId = todoId) =>
  as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, ${title}, 1, ${editor.id}) returning id`)[0]!.id as string)

const copyCard = (userId: string, src: string, column: string, asTemplate: boolean, withAssignees = false, dueInDays: number | null = null) =>
  as(userId, async sql => (await sql`select app.copy_card(${src}, ${column}, ${asTemplate}, ${withAssignees}, ${dueInDays}) as id`)[0]!.id as string)

/** A template with tag A, two checklist items (one done), a field value, priority, estimate and an assignee. */
async function richTemplate(srcColumn = todoId) {
  const src = await newCard('Weekly report', srcColumn)
  await as(editor.id, async (sql) => {
    await sql`update cards set description = 'Body', priority = 'high', estimate = 3, due_date = current_date + 3 where id = ${src}`
    await sql`insert into card_tags (card_id, tag_id, board_id) values (${src}, ${tagA}, ${boardId})`
    await sql`insert into card_assignees (card_id, user_id, board_id) values (${src}, ${editor.id}, ${boardId})`
    await sql`insert into checklist_items (card_id, board_id, text, done, position) values (${src}, ${boardId}, 'One', true, 1), (${src}, ${boardId}, 'Two', false, 2)`
    await sql`insert into card_field_values (card_id, board_id, field_id, value) values (${src}, ${boardId}, ${fieldId}, '"x"')`
  })
  return copyCard(editor.id, src, todoId, true, true)
}

const cardState = (id: string) => as(boardOwner.id, async (sql) => {
  const [c] = await sql`select title, description, priority, estimate::float8 as estimate, due_date::text as due, is_template, column_id,
    array(select tag_id::text from card_tags where card_id = c.id order by tag_id) as tags,
    array(select user_id::text from card_assignees where card_id = c.id) as assignees,
    array(select text || ':' || done from checklist_items where card_id = c.id order by position) as checklist,
    array(select value #>> '{}' from card_field_values where card_id = c.id) as fields,
    (select count(*)::int from card_activity where card_id = c.id) as activity,
    (select count(*)::int from card_watchers where card_id = c.id) as watchers
    from cards c where id = ${id}`
  return c!
})

beforeAll(async () => {
  ;[boardOwner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Template board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    ;[{ id: tagA }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'a', '#ff0000') returning id` as any
    ;[{ id: tagB }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'b', '#00ff00') returning id` as any
    ;[{ id: fieldId }] = await sql`insert into board_fields (board_id, name, kind, position) values (${boardId}, 'Note', 'text', 1) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
  boards.push(boardId)
})

afterAll(async () => {
  for (const b of boards) await owner`delete from boards where id = ${b}`
  await owner`delete from users where id = any(${[boardOwner, editor, viewer, outsider].map(u => u.id)})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('templates', () => {
  it('save as template copies content, unticks the checklist, drops dates; no rules, activity or watchers', async () => {
    // A rule on the template's column must not touch it.
    await as(boardOwner.id, sql => sql`insert into column_rules (board_id, column_id, kind, tag_id) values (${boardId}, ${todoId}, 'apply_tag', ${tagB})`)
    try {
      const tpl = await richTemplate(doneId)
      expect(await cardState(tpl)).toMatchObject({
        title: 'Weekly report', description: 'Body', priority: 'high', estimate: 3, due: null, is_template: true, column_id: todoId,
        tags: [tagA], assignees: [editor.id], checklist: ['One:false', 'Two:false'], fields: ['x'], activity: 0, watchers: 0,
      })
      // Assignees only when asked for.
      const src = await newCard()
      await as(editor.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${src}, ${editor.id}, ${boardId})`)
      expect((await cardState(await copyCard(editor.id, src, todoId, true))).assignees).toEqual([])
    }
    finally {
      await as(boardOwner.id, sql => sql`delete from column_rules where column_id = ${todoId}`)
    }
  })

  it('a card cannot become a template or stop being one', async () => {
    const card = await newCard()
    await rejectsWith(as(editor.id, sql => sql`update cards set is_template = true where id = ${card}`), 'KB007')
    const tpl = await copyCard(editor.id, card, todoId, true)
    await rejectsWith(as(editor.id, sql => sql`update cards set is_template = false where id = ${tpl}`), 'KB007')
    // Editing a template otherwise works as for any card.
    expect((await as(editor.id, sql => sql`update cards set title = 'Renamed', column_id = ${doneId} where id = ${tpl}`)).count).toBe(1)
    expect((await cardState(tpl)).activity).toBe(0)
  })

  it('creating from a template copies it and runs the column rules', async () => {
    const tpl = await richTemplate()
    await as(boardOwner.id, sql => sql`
      insert into column_rules (board_id, column_id, kind, tag_id) values (${boardId}, ${doneId}, 'remove_tag', ${tagA}), (${boardId}, ${doneId}, 'apply_tag', ${tagB})`)
    await as(boardOwner.id, sql => sql`insert into column_rules (board_id, column_id, kind, due_days) values (${boardId}, ${doneId}, 'set_due', 7)`)
    try {
      const card = await copyCard(editor.id, tpl, doneId, false, true, 2)
      const [today] = await owner`select (current_date + 7)::text as due`
      expect(await cardState(card)).toMatchObject({
        is_template: false, column_id: doneId, tags: [tagB], assignees: [editor.id], checklist: ['One:false', 'Two:false'],
        fields: ['x'], estimate: 3, priority: 'high', due: today!.due, watchers: 1,
      })
      expect((await cardState(card)).activity).toBeGreaterThan(0)
      // Without a set_due rule, due_in_days applies.
      const plain = await copyCard(editor.id, tpl, todoId, false, false, 2)
      const [due] = await owner`select (current_date + 2)::text as due`
      expect(await cardState(plain)).toMatchObject({ due: due!.due, tags: [tagA] })
    }
    finally {
      await as(boardOwner.id, sql => sql`delete from column_rules where column_id = ${doneId}`)
    }
  })

  it('only templates are copied into cards; RLS applies to the copy', async () => {
    const card = await newCard()
    await rejectsWith(copyCard(editor.id, card, todoId, false), 'KB008')
    const tpl = await copyCard(editor.id, card, todoId, true)
    await rejectsWith(copyCard(viewer.id, tpl, todoId, false), '42501')
    await rejectsWith(copyCard(outsider.id, tpl, todoId, false), 'P0002')
    // Viewers see templates like any card.
    expect((await as(viewer.id, sql => sql`select id from cards where id = ${tpl}`)).length).toBe(1)
  })

  it('templates notify nobody and are not in the due list of the digest', async () => {
    const tpl = await richTemplate()
    await as(boardOwner.id, sql => sql`update cards set due_date = current_date where id = ${tpl}`)
    await as(boardOwner.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${tpl}, ${viewer.id}, ${boardId})`)
    expect((await owner`select count(*)::int as n from notifications where card_id = ${tpl}`)[0]!.n).toBe(0)
    await auth`update users set digest_enabled = true, email_verified_at = now() where id = ${viewer.id}`
    const rows = await auth`select * from app.claim_digests() where user_id = ${viewer.id}`
    expect(rows.flatMap(r => r.due).some((d: { cardId: string }) => d.cardId === tpl)).toBe(false)
  })

  it('copying a board keeps templates as templates', async () => {
    const tpl = await richTemplate()
    const [copy] = await as(boardOwner.id, sql => sql`select id from app.copy_board(${boardId}, 'Copy', null, true)`)
    boards.push(copy!.id)
    const rows = await as(boardOwner.id, sql => sql`select title, is_template from cards where board_id = ${copy!.id} and is_template`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some(r => r.title === 'Weekly report')).toBe(true)
    expect(tpl).toBeTruthy()
  })
})

describe('recurrence_next', () => {
  const next = async (rule: string, step: number, weekdays: number[] | null, dom: number | null, d: string, first: boolean) =>
    (await owner`select app.recurrence_next(${rule}::recurrence_rule, ${step}, ${weekdays}::smallint[], ${dom}::smallint, ${d}::date, ${first})::text as d`)[0]!.d

  it('daily', async () => {
    expect(await next('daily', 3, null, null, '2026-10-14', true)).toBe('2026-10-14')
    expect(await next('daily', 3, null, null, '2026-10-14', false)).toBe('2026-10-17')
    expect(await next('daily', 1, null, null, '2026-12-31', false)).toBe('2027-01-01')
  })

  it('weekly: rest of the week first, then every n-th week', async () => {
    // 2026-10-14 is a Wednesday.
    expect(await next('weekly', 1, [3], null, '2026-10-14', true)).toBe('2026-10-14')
    expect(await next('weekly', 1, [1, 5], null, '2026-10-14', true)).toBe('2026-10-16')
    expect(await next('weekly', 2, [1, 5], null, '2026-10-14', true)).toBe('2026-10-16')
    expect(await next('weekly', 1, [1], null, '2026-10-14', true)).toBe('2026-10-19')
    expect(await next('weekly', 2, [1, 5], null, '2026-10-16', false)).toBe('2026-10-26')
    expect(await next('weekly', 1, [1, 5], null, '2026-10-12', false)).toBe('2026-10-16')
    expect(await next('weekly', 3, [7], null, '2026-10-18', false)).toBe('2026-11-08')
  })

  it('monthly: clamps to short months', async () => {
    expect(await next('monthly', 1, null, 20, '2026-10-14', true)).toBe('2026-10-20')
    expect(await next('monthly', 1, null, 5, '2026-10-14', true)).toBe('2026-11-05')
    expect(await next('monthly', 1, null, 31, '2026-02-10', true)).toBe('2026-02-28')
    expect(await next('monthly', 1, null, 31, '2028-02-10', true)).toBe('2028-02-29')
    expect(await next('monthly', 1, null, 31, '2026-01-31', false)).toBe('2026-02-28')
    expect(await next('monthly', 1, null, 31, '2026-02-28', false)).toBe('2026-03-31')
    expect(await next('monthly', 2, null, 31, '2026-08-31', false)).toBe('2026-10-31')
    expect(await next('monthly', 1, null, 31, '2026-03-31', false)).toBe('2026-04-30')
    expect(await next('monthly', 12, null, 15, '2026-10-15', false)).toBe('2027-10-15')
  })
})

describe('recurrences', () => {
  const schedule = (userId: string, template: string, fields: { rule?: string, weekdays?: number[] | null, dom?: number | null } = {}) =>
    as(userId, async sql => (await sql`
      insert into card_recurrences (board_id, template_card_id, column_id, rule, weekdays, day_of_month, due_in_days, created_by, next_run_at)
      values (${boardId}, ${template}, ${doneId}, ${fields.rule ?? 'daily'}, ${fields.weekdays ?? null}::smallint[], ${fields.dom ?? null},
              1, ${userId}, now() + interval '10 years')
      returning id, next_run_at::date::text as next, created_by`)[0]!)

  const run = async () => (await auth`select * from app.run_due_recurrences()`).map(r => ({ recurrence: r.recurrence_id as string, card: r.card_id as string }))
  const makeDue = (id: string) => owner`update card_recurrences set next_run_at = now() - interval '1 minute' where id = ${id}`

  it('editors schedule templates; viewers read; next run is set by trigger', async () => {
    const tpl = await copyCard(editor.id, await newCard(), todoId, true)
    await rejectsWith(schedule(viewer.id, tpl), '42501')
    const rec = await schedule(editor.id, tpl)
    const [today] = await owner`select current_date::text as d`
    expect(rec.next).toBe(today!.d)
    expect((await as(viewer.id, sql => sql`select id from card_recurrences where id = ${rec.id}`)).length).toBe(1)
    expect((await as(outsider.id, sql => sql`select id from card_recurrences where id = ${rec.id}`)).length).toBe(0)
    expect((await as(viewer.id, sql => sql`update card_recurrences set interval = 2 where id = ${rec.id}`)).count).toBe(0)
    await rejectsWith(as(editor.id, sql => sql`update card_recurrences set next_run_at = now() where id = ${rec.id}`), '42501')
    // Changing the schedule recomputes the next run and makes the editor its owner.
    const [changed] = await as(boardOwner.id, sql => sql`update card_recurrences set rule = 'monthly', day_of_month = 31 where id = ${rec.id} returning created_by, next_run_at::date::text as next`)
    const [expected] = await owner`select app.recurrence_next('monthly', 1, null, 31::smallint, current_date, true)::text as d`
    expect(changed).toEqual({ created_by: boardOwner.id, next: expected!.d })
    // Weekly needs weekdays.
    const other = await copyCard(editor.id, await newCard(), todoId, true)
    await rejectsWith(schedule(editor.id, other, { rule: 'weekly' }), '23514')
    expect((await schedule(editor.id, other, { rule: 'weekly', weekdays: [1, 3] })).id).toBeTruthy()
  })

  it('only templates of the same board can repeat', async () => {
    await rejectsWith(schedule(editor.id, await newCard()), 'KB008')
  })

  it('kanban_app cannot run schedules', async () => {
    await rejectsWith(as(editor.id, sql => sql`select * from app.run_due_recurrences()`), '42501')
  })

  it('runs due schedules once, as their owner, and advances them', async () => {
    const tpl = await richTemplate()
    const rec = await schedule(editor.id, tpl)
    await makeDue(rec.id)
    // Two runners at once: the row is claimed by one of them.
    const results = (await Promise.all([run(), run()])).flat().filter(r => r.recurrence === rec.id)
    expect(results.length).toBe(1)
    expect(await cardState(results[0]!.card)).toMatchObject({ is_template: false, column_id: doneId, tags: [tagA], assignees: [editor.id], checklist: ['One:false', 'Two:false'] })
    const [created] = await owner`select created_by from cards where id = ${results[0]!.card}`
    expect(created!.created_by).toBe(editor.id)
    const [row] = await owner`select next_run_at::date::text as next, last_run_at is not null as ran, active from card_recurrences where id = ${rec.id}`
    const [tomorrow] = await owner`select (current_date + 1)::text as d`
    expect(row).toEqual({ next: tomorrow!.d, ran: true, active: true })
    expect((await run()).filter(r => r.recurrence === rec.id)).toEqual([])
    // Editing after today's run schedules the next one for tomorrow, not today.
    await as(editor.id, sql => sql`update card_recurrences set active = false where id = ${rec.id}`)
    const [again] = await as(editor.id, sql => sql`update card_recurrences set active = true where id = ${rec.id} returning next_run_at::date::text as next`)
    expect(again!.next).toBe(tomorrow!.d)
  })

  it('switches off when the owner lost edit rights; archived boards create nothing', async () => {
    const tpl = await copyCard(editor.id, await newCard(), todoId, true)
    const rec = await schedule(editor.id, tpl)
    await as(boardOwner.id, sql => sql`update board_members set role = 'viewer' where board_id = ${boardId} and user_id = ${editor.id}`)
    try {
      await makeDue(rec.id)
      expect((await run()).filter(r => r.recurrence === rec.id)).toEqual([])
      expect((await owner`select active from card_recurrences where id = ${rec.id}`)[0]!.active).toBe(false)
    }
    finally {
      await as(boardOwner.id, sql => sql`update board_members set role = 'editor' where board_id = ${boardId} and user_id = ${editor.id}`)
    }

    const rec2 = await schedule(editor.id, await copyCard(editor.id, await newCard(), todoId, true))
    await makeDue(rec2.id)
    await as(boardOwner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    try {
      expect((await run()).filter(r => r.recurrence === rec2.id)).toEqual([])
      const [row] = await owner`select next_run_at > now() as advanced, active from card_recurrences where id = ${rec2.id}`
      expect(row).toEqual({ advanced: true, active: true })
    }
    finally {
      await as(boardOwner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
    }
  })

  it('deleting the template deletes its schedule', async () => {
    const tpl = await copyCard(editor.id, await newCard(), todoId, true)
    const rec = await schedule(editor.id, tpl)
    await as(editor.id, sql => sql`delete from cards where id = ${tpl}`)
    expect((await owner`select id from card_recurrences where id = ${rec.id}`).length).toBe(0)
  })
})
