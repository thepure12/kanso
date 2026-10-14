// RLS and trigger tests for card start dates, estimates, cover images and
// time entries. Same setup as card-features.test.ts.
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

type User = { id: string, email: string }
let owner: User, editor: User, editor2: User, viewer: User, outsider: User
let boardId: string
let todoId: string
let doneId: string
const boards: string[] = []

const newCard = (title = 'Card', columnId = todoId) =>
  as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, ${title}, 1, ${editor.id}) returning id`)[0]!.id as string)

const attach = (cardId: string, contentType: string) => as(editor.id, async (sql) => {
  const data = Buffer.from('hello')
  const [a] = await sql`insert into card_attachments (card_id, board_id, name, content_type, size, data, uploaded_by)
    values (${cardId}, ${boardId}, 'f', ${contentType}, 5, ${data}, ${editor.id}) returning id`
  return a!.id as string
})

const logTime = (userId: string, cardId: string, minutes = 30, forUser = userId) =>
  as(userId, async sql => (await sql`insert into time_entries (card_id, board_id, user_id, minutes) values (${cardId}, ${boardId}, ${forUser}, ${minutes}) returning id`)[0]!.id as string)

beforeAll(async () => {
  ;[owner, editor, editor2, viewer, outsider] = await Promise.all(['owner', 'editor', 'editor2', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Schedule board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${editor2.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
  boards.push(boardId)
})

afterAll(async () => {
  for (const b of boards) await as(owner.id, sql => sql`delete from boards where id = ${b}`)
  await Promise.all([app.end(), auth.end()])
})

describe('start date and estimate', () => {
  it('start date must not be after the due date; estimate must not be negative', async () => {
    const id = await newCard()
    await as(editor.id, sql => sql`update cards set start_date = '2026-12-01', due_date = '2026-12-05', estimate = 2.5 where id = ${id}`)
    await rejectsWith(as(editor.id, sql => sql`update cards set start_date = '2026-12-06' where id = ${id}`), '23514')
    await rejectsWith(as(editor.id, sql => sql`update cards set estimate = -1 where id = ${id}`), '23514')
    // Either date alone is fine.
    await as(editor.id, sql => sql`update cards set due_date = null, start_date = '2027-01-01' where id = ${id}`)
    const [row] = await as(viewer.id, sql => sql`select start_date::text as start, estimate::float8 as estimate from cards where id = ${id}`)
    expect(row).toEqual({ start: '2027-01-01', estimate: 2.5 })
  })

  it('changes are logged as activity', async () => {
    const id = await newCard()
    await as(editor.id, sql => sql`update cards set start_date = '2026-12-01', estimate = 3 where id = ${id}`)
    const rows = await as(owner.id, sql => sql`select kind, data from card_activity where card_id = ${id} and kind in ('start', 'estimate') order by kind`)
    expect(rows.map(r => ({ kind: r.kind, data: r.data }))).toEqual([
      { kind: 'estimate', data: { to: '3.00' } },
      { kind: 'start', data: { to: '2026-12-01' } },
    ])
  })

  it('a set_due rule pulls a later start date back to the new due date', async () => {
    const id = await newCard()
    await as(editor.id, sql => sql`update cards set start_date = current_date + 30 where id = ${id}`)
    const [rule] = await as(owner.id, sql => sql`insert into column_rules (board_id, column_id, kind, due_days) values (${boardId}, ${doneId}, 'set_due', 2) returning id`)
    try {
      await as(editor.id, sql => sql`update cards set column_id = ${doneId} where id = ${id}`)
      const [row] = await as(editor.id, sql => sql`select (due_date - current_date) as due, (start_date - current_date) as start from cards where id = ${id}`)
      expect(row).toEqual({ due: 2, start: 2 })
    }
    finally {
      await as(owner.id, sql => sql`delete from column_rules where id = ${rule!.id}`)
    }
  })

  it('app.copy_board copies start date and estimate', async () => {
    const id = await newCard('Scheduled')
    await as(editor.id, sql => sql`update cards set start_date = '2026-11-01', due_date = '2026-11-02', estimate = 5 where id = ${id}`)
    const [b] = await as(owner.id, sql => sql`select id from app.copy_board(${boardId}, 'Copy', null, true)`)
    boards.push(b!.id)
    const [row] = await as(owner.id, sql => sql`select start_date::text as start, estimate::float8 as estimate from cards where board_id = ${b!.id} and title = 'Scheduled'`)
    expect(row).toEqual({ start: '2026-11-01', estimate: 5 })
  })
})

describe('cover image', () => {
  it('must be an image attachment of the same card', async () => {
    const id = await newCard()
    const other = await newCard()
    const png = await attach(id, 'image/png')
    const text = await attach(id, 'text/plain')
    const svg = await attach(id, 'image/svg+xml')
    const otherPng = await attach(other, 'image/png')
    await rejectsWith(as(editor.id, sql => sql`update cards set cover_attachment_id = ${text} where id = ${id}`), 'KB003')
    await rejectsWith(as(editor.id, sql => sql`update cards set cover_attachment_id = ${svg} where id = ${id}`), 'KB003')
    await rejectsWith(as(editor.id, sql => sql`update cards set cover_attachment_id = ${otherPng} where id = ${id}`), 'KB003')
    expect((await as(viewer.id, sql => sql`update cards set cover_attachment_id = ${png} where id = ${id}`)).count).toBe(0)
    await as(editor.id, sql => sql`update cards set cover_attachment_id = ${png} where id = ${id}`)
    const [row] = await as(viewer.id, sql => sql`select cover_attachment_id as cover from cards where id = ${id}`)
    expect(row!.cover).toBe(png)
  })

  it('is cleared when the attachment is deleted', async () => {
    const id = await newCard()
    const png = await attach(id, 'image/webp')
    await as(editor.id, sql => sql`update cards set cover_attachment_id = ${png} where id = ${id}`)
    await as(editor.id, sql => sql`delete from card_attachments where id = ${png}`)
    const [row] = await as(editor.id, sql => sql`select cover_attachment_id as cover from cards where id = ${id}`)
    expect(row!.cover).toBeNull()
  })
})

describe('time_entries', () => {
  it('editors log their own time; viewers read; outsiders see nothing', async () => {
    const id = await newCard()
    await logTime(editor.id, id, 90)
    await rejectsWith(logTime(editor.id, id, 30, editor2.id), '42501')
    await rejectsWith(logTime(viewer.id, id), '42501')
    await rejectsWith(logTime(outsider.id, id), '42501')
    await rejectsWith(logTime(editor.id, id, 0), '23514')
    expect(await as(viewer.id, sql => sql`select minutes from time_entries where card_id = ${id}`)).toEqual([{ minutes: 90 }])
    expect(await as(outsider.id, sql => sql`select 1 from time_entries where card_id = ${id}`)).toHaveLength(0)
  })

  it('people edit and delete only their own entries; owners delete any', async () => {
    const id = await newCard()
    const mine = await logTime(editor.id, id)
    const theirs = await logTime(editor2.id, id)
    expect((await as(editor.id, sql => sql`update time_entries set minutes = 45 where id = ${theirs}`)).count).toBe(0)
    expect((await as(owner.id, sql => sql`update time_entries set minutes = 45 where id = ${theirs}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`update time_entries set minutes = 45, note = 'review' where id = ${mine}`)).count).toBe(1)
    // user_id is not updatable.
    await rejectsWith(as(editor.id, sql => sql`update time_entries set user_id = ${editor2.id} where id = ${mine}`), '42501')
    expect((await as(editor.id, sql => sql`delete from time_entries where id = ${theirs}`)).count).toBe(0)
    expect((await as(viewer.id, sql => sql`delete from time_entries where id = ${mine}`)).count).toBe(0)
    expect((await as(owner.id, sql => sql`delete from time_entries where id = ${theirs}`)).count).toBe(1)
    expect((await as(editor.id, sql => sql`delete from time_entries where id = ${mine}`)).count).toBe(1)
  })

  it('cannot point at a card of another board', async () => {
    const id = await newCard()
    const [other] = await as(editor.id, sql => sql`select id from app.create_board('Other')`)
    boards.push(other!.id)
    await rejectsWith(as(editor.id, sql => sql`insert into time_entries (card_id, board_id, user_id, minutes) values (${id}, ${other!.id}, ${editor.id}, 5)`), '23503')
  })

  it('notifies board listeners', async () => {
    const id = await newCard()
    const received: string[] = []
    const listener = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
    try {
      await listener.listen('board_changes', p => received.push(p))
      await logTime(editor.id, id)
      await expect.poll(() => received.some(p => JSON.parse(p).b === boardId)).toBe(true)
    }
    finally {
      await listener.end()
    }
  })
})
