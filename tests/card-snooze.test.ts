// Snoozed cards (cards.snoozed_until, 0093/0094): activity, the wake-up
// (app.wake_snoozed_cards), notifications for watchers, automations skipping
// snoozed cards and the template check. Same setup as board-automations.test.ts.
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
let boardOwner: User, editor: User, viewer: User, watcher: User
let boardId: string
let todoId: string

const newCard = (title = 'Card') =>
  as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, ${title}, 1, ${editor.id}) returning id`)[0]!.id as string)

const snooze = (userId: string, cardId: string, until: string | null) =>
  as(userId, sql => sql`update cards set snoozed_until = ${until} where id = ${cardId} returning id`)

const wake = async () => (await auth`select * from app.wake_snoozed_cards(${boardId})`).map(r => r.card_id as string)

const activity = (cardId: string) => owner`select kind, actor_id, data from card_activity where card_id = ${cardId} order by created_at`

beforeAll(async () => {
  ;[boardOwner, editor, viewer, watcher] = await Promise.all(['owner', 'editor', 'viewer', 'watcher'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Snooze board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2)`
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
    await sql`select app.add_board_member(${boardId}, ${watcher.email}, 'viewer')`
  })
})

afterAll(async () => {
  await owner`delete from boards where id = ${boardId}`
  await owner`delete from users where id = any(${[boardOwner, editor, viewer, watcher].map(u => u.id)})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('snoozing', () => {
  it('editors snooze and wake cards, viewers cannot; both are logged', async () => {
    const card = await newCard()
    expect(await snooze(viewer.id, card, '2099-01-01')).toHaveLength(0)
    expect(await snooze(editor.id, card, '2099-01-01')).toHaveLength(1)
    expect(await snooze(editor.id, card, null)).toHaveLength(1)
    const kinds = (await activity(card)).map(a => [a.kind, a.data.until ?? null])
    expect(kinds).toEqual([['created', null], ['snoozed', '2099-01-01'], ['woke', null]])
  })

  it('refuses templates', async () => {
    const tpl = await as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, is_template, created_by) values (${boardId}, ${todoId}, 'Tpl', 1, true, ${editor.id}) returning id`)[0]!.id as string)
    await expect(snooze(editor.id, tpl, '2099-01-01')).rejects.toMatchObject({ code: '23514', constraint_name: 'cards_snooze_not_template' })
  })

  it('kanban_app cannot run the wake-up', async () => {
    await expect(app`select * from app.wake_snoozed_cards(${boardId})`).rejects.toMatchObject({ code: '42501' })
  })
})

describe('waking', () => {
  it('wakes cards whose day has come as an automation and notifies watchers', async () => {
    const due = await newCard('Due')
    const later = await newCard('Later')
    await as(watcher.id, sql => sql`insert into card_watchers (card_id, board_id, user_id) values (${due}, ${boardId}, ${watcher.id})`)
    await snooze(editor.id, due, '2099-01-01')
    await snooze(editor.id, later, '2099-01-01')
    // The day has come for `due` only.
    await owner`update cards set snoozed_until = current_date where id = ${due}`

    expect(await wake()).toEqual([due])
    expect(await wake()).toEqual([])
    const [card] = await owner`select snoozed_until from cards where id = ${due}`
    expect(card!.snoozed_until).toBeNull()
    const woke = (await activity(due)).at(-1)!
    expect(woke).toMatchObject({ kind: 'woke', actor_id: null, data: { automation: true } })

    const notes = await owner`select n.user_id from notifications n join card_activity a on a.id = n.activity_id where a.card_id = ${due} and a.kind = 'woke'`
    // The watcher and the creator (auto-watch), nobody else.
    expect(notes.map(n => n.user_id).sort()).toEqual([watcher.id, editor.id].sort())
  })

  it('leaves archived cards and archived boards snoozed', async () => {
    const card = await newCard('Archived')
    await snooze(editor.id, card, '2099-01-01')
    await owner`update cards set snoozed_until = current_date - 1, archived_at = now() where id = ${card}`
    expect(await wake()).toEqual([])

    await owner`update cards set archived_at = null where id = ${card}`
    await owner`update boards set archived_at = now() where id = ${boardId}`
    try { expect(await wake()).toEqual([]) }
    finally { await owner`update boards set archived_at = null where id = ${boardId}` }
    expect(await wake()).toEqual([card])
  })

  it('counts as a reminder in notification settings', async () => {
    const card = await newCard('Muted')
    await as(watcher.id, sql => sql`insert into card_watchers (card_id, board_id, user_id) values (${card}, ${boardId}, ${watcher.id})`)
    await auth`update users set notification_prefs = '{"reminder": {"inbox": false}}' where id = ${watcher.id}`
    try {
      await snooze(editor.id, card, '2099-01-01')
      await snooze(editor.id, card, null)
      const notes = await owner`select n.user_id from notifications n join card_activity a on a.id = n.activity_id where a.card_id = ${card} and a.kind = 'woke'`
      expect(notes.map(n => n.user_id)).not.toContain(watcher.id)
    }
    finally { await auth`update users set notification_prefs = '{}' where id = ${watcher.id}` }
  })
})

describe('automations', () => {
  it('skip snoozed cards, also for the card\'s own automations', async () => {
    const card = await newCard('Stale')
    await owner`update cards set created_at = now() - interval '10 days' where id = ${card}`
    await owner`update card_activity set created_at = now() - interval '10 days' where card_id = ${card}`
    const [boardWide, own] = await as(editor.id, async sql => [
      (await sql`insert into board_automations (board_id, kind, days) values (${boardId}, 'notify_stale', 3) returning id`)[0]!.id as string,
      (await sql`insert into board_automations (board_id, kind, days, priority, card_id) values (${boardId}, 'raise_priority', 3, 'high', ${card}) returning id`)[0]!.id as string,
    ])
    await owner`update cards set due_date = current_date where id = ${card}`
    await owner`update cards set snoozed_until = '2099-01-01' where id = ${card}`
    try {
      const changed = (await auth`select * from app.run_board_automations(${boardId})`).filter(r => r.card_id === card)
      expect(changed).toEqual([])
      // Waking by hand is activity, so make the card stale again.
      await owner`update cards set snoozed_until = null where id = ${card}`
      await owner`update card_activity set created_at = now() - interval '10 days' where card_id = ${card}`
      const after = (await auth`select * from app.run_board_automations(${boardId})`).filter(r => r.card_id === card).map(r => r.automation_id)
      expect(after.sort()).toEqual([boardWide, own].sort())
    }
    finally { await owner`delete from board_automations where id = any(${[boardWide!, own!]})` }
  })
})
