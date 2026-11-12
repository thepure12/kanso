// Time-based board automations (board_automations, app.run_board_automations).
// Same setup as card-templates.test.ts; the owner role backdates cards and
// their activity to make them old enough.
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
let todoId: string
let doneId: string
let tagId: string
const boards: string[] = []

const newCard = (columnId = todoId, title = 'Card') =>
  as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, ${title}, 1, ${editor.id}) returning id`)[0]!.id as string)

/** Moves the card's creation and all its activity `days` days into the past. */
const age = (cardId: string, days: number) => owner.begin(sql => [
  sql`update cards set created_at = created_at - make_interval(days => ${days}) where id = ${cardId}`,
  sql`update card_activity set created_at = created_at - make_interval(days => ${days}) where card_id = ${cardId}`,
])

const automate = (userId: string, kind: string, days: number, extra: { tagId?: string, priority?: string } = {}) =>
  as(userId, async sql => (await sql`insert into board_automations (board_id, kind, days, tag_id, priority)
    values (${boardId}, ${kind}, ${days}, ${extra.tagId ?? null}, ${extra.priority ?? null}) returning id`)[0]!.id as string)

/** Runs the test board's automations (never the rest of the database); returns the card ids changed by `automationId`. */
const run = async (automationId: string) => (await auth`select * from app.run_board_automations(${boardId})`)
  .filter(r => r.automation_id === automationId).map(r => r.card_id as string)

const remove = (id: string) => owner`delete from board_automations where id = ${id}`

const lastActivity = async (cardId: string) => (await owner`select kind, actor_id, data from card_activity where card_id = ${cardId} order by created_at desc limit 1`)[0]!

beforeAll(async () => {
  ;[boardOwner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Automation board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    ;[{ id: tagId }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'stale', '#ff0000') returning id` as any
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

describe('board automations', () => {
  it('editors manage them, viewers read, outsiders see nothing', async () => {
    await rejectsWith(automate(viewer.id, 'archive_done', 7), '42501')
    const id = await automate(editor.id, 'archive_done', 7)
    try {
      expect((await as(viewer.id, sql => sql`select id from board_automations where id = ${id}`)).length).toBe(1)
      expect((await as(outsider.id, sql => sql`select id from board_automations where id = ${id}`)).length).toBe(0)
      expect((await as(viewer.id, sql => sql`update board_automations set days = 2 where id = ${id}`)).count).toBe(0)
      expect((await as(editor.id, sql => sql`update board_automations set days = 2, active = false where id = ${id}`)).count).toBe(1)
      // Kind is fixed (column grant).
      await rejectsWith(as(editor.id, sql => sql`update board_automations set kind = 'notify_stale' where id = ${id}`), '42501')
      // The same automation twice.
      await rejectsWith(automate(editor.id, 'archive_done', 3), '23505')
    }
    finally {
      await remove(id)
    }
  })

  it('checks the fields of each kind', async () => {
    await rejectsWith(automate(editor.id, 'tag_stale', 7), '23514')
    await rejectsWith(automate(editor.id, 'raise_priority', 7), '23514')
    await rejectsWith(automate(editor.id, 'archive_done', 0), '23514')
    await rejectsWith(automate(editor.id, 'notify_stale', 7, { priority: 'high' }), '23514')
  })

  it('kanban_app cannot run automations', async () => {
    await rejectsWith(as(editor.id, sql => sql`select * from app.run_board_automations()`), '42501')
  })

  it('archive_done archives cards that sat in the last column long enough', async () => {
    const old = await newCard(doneId)
    const fresh = await newCard(doneId)
    const open = await newCard(todoId)
    await age(old, 8)
    await age(open, 8)
    // Moved into the last column today: not yet.
    const movedToday = await newCard(todoId)
    await age(movedToday, 8)
    await as(editor.id, sql => sql`update cards set column_id = ${doneId} where id = ${movedToday}`)
    const id = await automate(editor.id, 'archive_done', 7)
    try {
      expect(await run(id)).toEqual([old])
      const [row] = await owner`select archived_at is not null as archived from cards where id = ${old}`
      expect(row!.archived).toBe(true)
      expect(await lastActivity(old)).toMatchObject({ kind: 'archived', actor_id: null, data: { automation: true } })
      // Nothing left to do.
      expect(await run(id)).toEqual([])
      expect((await owner`select last_run_at is not null as ran from board_automations where id = ${id}`)[0]!.ran).toBe(true)
      void fresh
    }
    finally {
      await remove(id)
    }
  })

  it('tag_stale tags open cards without recent activity', async () => {
    const stale = await newCard(todoId)
    const active = await newCard(todoId)
    const done = await newCard(doneId)
    await age(stale, 10)
    await age(done, 10)
    const id = await automate(editor.id, 'tag_stale', 5, { tagId })
    try {
      const tagged = await run(id)
      expect(tagged).toContain(stale)
      expect(tagged).not.toContain(active)
      expect(tagged).not.toContain(done)
      expect(await lastActivity(stale)).toMatchObject({ kind: 'tagged', actor_id: null, data: { tag: 'stale', automation: true } })
      expect(await run(id)).toEqual([])
    }
    finally {
      await remove(id)
    }
  })

  it('notify_stale logs stale and notifies assignees once per period', async () => {
    const stale = await newCard(todoId)
    await as(editor.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${stale}, ${editor.id}, ${boardId})`)
    await age(stale, 4)
    const id = await automate(editor.id, 'notify_stale', 3)
    try {
      expect(await run(id)).toContain(stale)
      const act = await lastActivity(stale)
      expect(act).toMatchObject({ kind: 'stale', actor_id: null, data: { days: 3, automation: true } })
      const notes = await owner`select n.user_id from notifications n join card_activity a on a.id = n.activity_id
        where n.card_id = ${stale} and a.kind = 'stale'`
      expect(notes.map(n => n.user_id)).toEqual([editor.id])
      // At most once per 3 days.
      expect(await run(id)).not.toContain(stale)
      // Until someone touches the card again, it is reported every 3 days.
      await age(stale, 3)
      expect(await run(id)).toContain(stale)
    }
    finally {
      await remove(id)
    }
  })

  it('tagging by one automation does not hide a card from notify_stale', async () => {
    const stale = await newCard(todoId)
    await age(stale, 10)
    const tag = await automate(editor.id, 'tag_stale', 5, { tagId })
    const notify = await automate(editor.id, 'notify_stale', 5)
    try {
      const rows = (await auth`select * from app.run_board_automations(${boardId})`).filter(r => r.card_id === stale)
      expect(rows.map(r => r.automation_id)).toEqual([tag, notify])
      // A person's activity resets it.
      await as(editor.id, sql => sql`update cards set title = 'Touched' where id = ${stale}`)
      await age(stale, 6)
      await as(editor.id, sql => sql`update cards set title = 'Touched again' where id = ${stale}`)
      expect(await run(notify)).not.toContain(stale)
    }
    finally {
      await remove(tag)
      await remove(notify)
    }
  })

  it('raise_priority raises cards due soon, never lowers', async () => {
    const soon = await newCard(todoId)
    const later = await newCard(todoId)
    const urgent = await newCard(todoId)
    const done = await newCard(doneId)
    await as(editor.id, sql => sql`update cards set due_date = current_date + 1, priority = 'low' where id = ${soon}`)
    await as(editor.id, sql => sql`update cards set due_date = current_date + 10 where id = ${later}`)
    await as(editor.id, sql => sql`update cards set due_date = current_date, priority = 'urgent' where id = ${urgent}`)
    await as(editor.id, sql => sql`update cards set due_date = current_date where id = ${done}`)
    const id = await automate(editor.id, 'raise_priority', 2, { priority: 'high' })
    try {
      expect(await run(id)).toEqual([soon])
      expect((await owner`select priority from cards where id = ${soon}`)[0]!.priority).toBe('high')
      expect(await lastActivity(soon)).toMatchObject({ kind: 'priority', actor_id: null, data: { automation: true } })
      expect(await run(id)).toEqual([])
    }
    finally {
      await remove(id)
    }
  })

  it('skips inactive automations and archived boards', async () => {
    const card = await newCard(doneId)
    await age(card, 10)
    const id = await automate(editor.id, 'archive_done', 1)
    try {
      await as(editor.id, sql => sql`update board_automations set active = false where id = ${id}`)
      expect(await run(id)).toEqual([])
      await as(editor.id, sql => sql`update board_automations set active = true where id = ${id}`)
      await as(boardOwner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
      expect(await run(id)).toEqual([])
    }
    finally {
      await as(boardOwner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
      await remove(id)
    }
  })

  it('deleting the tag deletes its automation', async () => {
    const [{ id: tmp }] = await as(editor.id, sql => sql`insert into tags (board_id, name, color) values (${boardId}, 'tmp', '#00ff00') returning id`) as any
    const id = await automate(editor.id, 'tag_stale', 5, { tagId: tmp })
    await as(editor.id, sql => sql`delete from tags where id = ${tmp}`)
    expect((await owner`select id from board_automations where id = ${id}`).length).toBe(0)
  })
})
