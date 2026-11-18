// Personal card reminders (card_reminders, app.run_card_reminders).
// The owner role moves reminders into the past to make them due.
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

const newCard = (extra: { template?: boolean, due?: string | null } = {}) =>
  as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by, is_template, due_date)
    values (${boardId}, ${todoId}, 'Card', 1, ${editor.id}, ${extra.template ?? false}, ${extra.due ?? null}) returning id`)[0]!.id as string)

const inOneHour = () => new Date(Date.now() + 3600_000)

/** A fixed-time reminder of `user` on `card`; returns its id. */
const remindAt = (user: User, card: string, at: Date = inOneHour(), note: string | null = null, forUser = user) =>
  as(user.id, async sql => (await sql`insert into card_reminders (card_id, board_id, user_id, remind_at, note)
    values (${card}, ${boardId}, ${forUser.id}, ${at}, ${note}) returning id`)[0]!.id as string)

/** A due-date reminder: `days` before the due date at `time` in `tz`. */
const remindBeforeDue = (user: User, card: string, days: number, time = '09:00', tz = 'Europe/Berlin') =>
  as(user.id, async sql => (await sql`insert into card_reminders (card_id, board_id, user_id, before_due_days, due_time, time_zone)
    values (${card}, ${boardId}, ${user.id}, ${days}, ${time}, ${tz}) returning id`)[0]!.id as string)

const reminder = async (id: string) => (await owner`select remind_at, sent_at from card_reminders where id = ${id}`)[0]
const makeDue = (id: string) => owner`update card_reminders set remind_at = now() - interval '1 minute' where id = ${id}`
const run = () => auth`select * from app.run_card_reminders(${boardId})`
const reminderNotifications = (card: string) => owner`select n.user_id from notifications n join card_activity a on a.id = n.activity_id
  where n.card_id = ${card} and a.kind = 'reminder'`

beforeAll(async () => {
  ;[boardOwner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Reminder board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2)`
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
})

afterAll(async () => {
  await owner`delete from boards where id = ${boardId}`
  await owner`delete from users where id = any(${[boardOwner, editor, viewer, outsider].map(u => u.id)})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('card reminders', () => {
  it('are personal: own rows only, viewers too, not outsiders', async () => {
    const card = await newCard()
    const mine = await remindAt(viewer, card)
    await remindAt(editor, card)
    expect((await as(viewer.id, sql => sql`select id from card_reminders where card_id = ${card}`)).map(r => r.id)).toEqual([mine])
    await rejectsWith(remindAt(editor, card, inOneHour(), null, viewer), '42501')
    await rejectsWith(remindAt(outsider, card), '42501')
    // Someone else's reminder cannot be deleted.
    expect(await as(editor.id, sql => sql`delete from card_reminders where id = ${mine} returning id`)).toHaveLength(0)
    expect(await as(viewer.id, sql => sql`delete from card_reminders where id = ${mine} returning id`)).toHaveLength(1)
  })

  it('refuses templates, past times and unknown time zones', async () => {
    const template = await newCard({ template: true })
    await rejectsWith(remindAt(editor, template), '42501')
    const card = await newCard({ due: '2000-01-10' })
    await rejectsWith(remindAt(editor, card, new Date(Date.now() - 60_000)), 'KB010')
    await rejectsWith(remindBeforeDue(editor, card, 1), 'KB010')
    const later = await newCard({ due: '2999-01-10' })
    await rejectsWith(remindBeforeDue(editor, later, 1, '09:00', 'Mars/Olympus'), '22023')
  })

  it('computes due-date reminders and follows due date changes', async () => {
    const card = await newCard()
    const id = await remindBeforeDue(editor, card, 2, '09:30', 'Europe/Berlin')
    expect((await reminder(id))!.remind_at).toBeNull()
    await as(editor.id, sql => sql`update cards set due_date = '2999-07-10' where id = ${card}`)
    // 2999-07-08 09:30 in Berlin (summer time, UTC+2).
    expect((await reminder(id))!.remind_at.toISOString()).toBe('2999-07-08T07:30:00.000Z')

    await makeDue(id)
    await run()
    expect((await reminder(id))!.sent_at).not.toBeNull()
    // A later due date re-arms it.
    await as(editor.id, sql => sql`update cards set due_date = '2999-12-24' where id = ${card}`)
    expect(await reminder(id)).toMatchObject({ sent_at: null })
    expect((await reminder(id))!.remind_at.toISOString()).toBe('2999-12-22T08:30:00.000Z')
  })

  it('notifies only its person and hides the entry from everyone else', async () => {
    const card = await newCard()
    // The editor created the card, so watches it; the owner is assigned.
    await as(editor.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${card}, ${boardOwner.id}, ${boardId})`)
    const id = await remindAt(viewer, card, inOneHour(), 'Ping the client')
    await makeDue(id)
    const ran = await run()
    expect(ran.filter(r => r.reminder_id === id)).toHaveLength(1)
    expect((await reminderNotifications(card)).map(n => n.user_id)).toEqual([viewer.id])
    const [entry] = await owner`select actor_id, data from card_activity where card_id = ${card} and kind = 'reminder'`
    expect(entry).toMatchObject({ actor_id: null, data: { user_id: viewer.id, note: 'Ping the client', automation: true } })
    expect(await as(viewer.id, sql => sql`select id from card_activity where card_id = ${card} and kind = 'reminder'`)).toHaveLength(1)
    expect(await as(editor.id, sql => sql`select id from card_activity where card_id = ${card} and kind = 'reminder'`)).toHaveLength(0)
    expect(await as(boardOwner.id, sql => sql`select id from card_activity where card_id = ${card} and kind = 'reminder'`)).toHaveLength(0)
    // Fixed-time reminders are gone once sent; a second run sends nothing.
    expect(await reminder(id)).toBeUndefined()
    expect((await run()).filter(r => r.card_id === card)).toHaveLength(0)
  })

  it('still notifies with the board level `direct`, never with `none`', async () => {
    const card = await newCard()
    await as(viewer.id, sql => sql`insert into board_notification_settings (user_id, board_id, level) values (${viewer.id}, ${boardId}, 'direct')`)
    try {
      await makeDue(await remindAt(viewer, card))
      await run()
      expect((await reminderNotifications(card)).map(n => n.user_id)).toEqual([viewer.id])
      await as(viewer.id, sql => sql`update board_notification_settings set level = 'none' where user_id = ${viewer.id} and board_id = ${boardId}`)
      const other = await newCard()
      await makeDue(await remindAt(viewer, other))
      await run()
      expect(await reminderNotifications(other)).toHaveLength(0)
    }
    finally {
      await owner`delete from board_notification_settings where user_id = ${viewer.id}`
    }
  })

  it('is not sent to webhooks', async () => {
    const card = await newCard()
    const [hook] = await owner`insert into board_webhooks (board_id, url, secret) values (${boardId}, 'https://example.test/hook', 's') returning id`
    try {
      await makeDue(await remindAt(viewer, card))
      await run()
      expect(await owner`select d.id from webhook_deliveries d join card_activity a on a.id = d.activity_id
        where a.card_id = ${card} and a.kind = 'reminder'`).toHaveLength(0)
    }
    finally {
      await owner`delete from board_webhooks where id = ${hook!.id}`
    }
  })

  it('waits while the card is trashed', async () => {
    const card = await newCard()
    const id = await remindAt(viewer, card)
    await as(editor.id, sql => sql`select app.trash_card(${card})`)
    await makeDue(id)
    await run()
    expect(await reminder(id)).toBeDefined()
  })
})
