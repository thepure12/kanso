// Notification settings (0070_notification_settings_rls.sql): per-event
// channels, watched cards on/off, per-board level, and their RLS.
import { randomBytes, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const owner_ = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

type User = { id: string, email: string, name: string }

async function createUser(name: string): Promise<User> {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email, name`
  return u as User
}

let ann: User, bob: User, cid: User, eve: User
let boardId: string, todoId: string, doneId: string

const setPrefs = (u: User, prefs: object, watching = true) =>
  as(u.id, sql => sql`update users set notification_prefs = ${sql.json(prefs as postgres.JSONValue)}, notify_watching = ${watching} where id = ${u.id}`)

const setLevel = (u: User, level: 'direct' | 'none' | null) =>
  as(u.id, sql => level
    ? sql`insert into board_notification_settings (user_id, board_id, level) values (${u.id}, ${boardId}, ${level})
          on conflict (user_id, board_id) do update set level = excluded.level`
    : sql`delete from board_notification_settings where user_id = ${u.id} and board_id = ${boardId}`)

// Ann creates the card (so she watches it) and assigns the given people.
const newCard = (...assignees: User[]) =>
  as(ann.id, async (sql) => {
    const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'Card', 1, ${ann.id}) returning id`
    for (const u of assignees) await sql`insert into card_assignees (card_id, user_id, board_id) values (${c!.id}, ${u.id}, ${boardId})`
    return c!.id as string
  })

const comment = (u: User, cardId: string, body = 'hi') =>
  as(u.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${cardId}, ${boardId}, ${u.id}, ${body})`)

const move = (u: User, cardId: string) =>
  as(u.id, sql => sql`update cards set column_id = ${doneId} where id = ${cardId}`)

const inbox = (u: User, cardId: string) =>
  as(u.id, async sql => (await sql`
    select a.kind from notifications n join card_activity a on a.id = n.activity_id
    where n.card_id = ${cardId} order by a.created_at, a.id`).map(r => r.kind as string))

const mention = (u: User) => `@[${u.name}](user:${u.id})`

beforeAll(async () => {
  ;[ann, bob, cid, eve] = await Promise.all(['ann', 'bob', 'cid', 'eve'].map(createUser))
  // A board created in the same transaction notifies nobody, so in two steps.
  const [{ id }] = await as(ann.id, sql => sql`select id from app.create_board('Notification settings board')`) as any
  boardId = id
  await as(ann.id, async (sql) => {
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${bob.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${cid.email}, 'editor')`
  })
})

afterAll(async () => {
  await as(ann.id, sql => sql`delete from boards where id = ${boardId}`)
  await owner_`delete from users where id in ${owner_([ann.id, bob.id, cid.id, eve.id])}`
  await Promise.all([app.end(), auth.end(), owner_.end()])
})

describe('prefs', () => {
  it('are writable but not readable by kanban_app, and checked for shape', async () => {
    await setPrefs(bob, { commented: { inbox: false } })
    await rejectsWith(as(bob.id, sql => sql`select notification_prefs from users where id = ${bob.id}`), '42501')
    await rejectsWith(setPrefs(bob, { nope: { inbox: false } }), '23514')
    await rejectsWith(setPrefs(bob, { moved: { sms: false } }), '23514')
    await rejectsWith(setPrefs(bob, { moved: { push: 'no' } }), '23514')
    await rejectsWith(setPrefs(bob, []), '23514')
    // Only one's own row (users_update policy).
    const changed = await as(eve.id, sql => sql`update users set notify_watching = false where id = ${bob.id}`)
    expect(changed.count).toBe(0)
    await setPrefs(bob, {})
  })

  it('inbox off: no notification for that event, others still arrive', async () => {
    await setPrefs(bob, { commented: { inbox: false } })
    const id = await newCard(bob)
    await comment(ann, id)
    await move(ann, id)
    expect(await inbox(bob, id)).toEqual(['assigned', 'moved'])
    await setPrefs(bob, {})
  })

  it('a comment that mentions someone counts as a mention for them', async () => {
    await setPrefs(bob, { commented: { inbox: false } })
    const id = await newCard(bob)
    await comment(ann, id, `look ${mention(bob)}`)
    expect(await inbox(bob, id)).toEqual(['assigned', 'commented'])
    await setPrefs(bob, { mentioned: { inbox: false } })
    await comment(ann, id, `again ${mention(bob)}`)
    await comment(ann, id, 'plain')
    expect(await inbox(bob, id)).toEqual(['assigned', 'commented', 'commented'])
    await setPrefs(bob, {})
  })

  it('push off: notification made, nothing queued for push', async () => {
    const [{ id: sid }] = await auth`insert into user_sessions (user_id, user_agent, ip) values (${bob.id}, 'test', '10.0.0.1') returning id` as any
    await as(bob.id, sql => sql`select app.save_push_subscription(${sid}::uuid, ${`https://push.example.test/${randomUUID()}`},
      ${randomBytes(65).toString('base64url')}, ${randomBytes(16).toString('base64url')}, 'test')`)
    const queued = (card: string) => owner_`select a.kind from push_messages m join notifications n on n.id = m.notification_id
      join card_activity a on a.id = n.activity_id where n.card_id = ${card} order by a.created_at`.then(r => r.map(x => x.kind))

    await setPrefs(bob, { moved: { push: false }, commented: { inbox: false, push: true } })
    const id = await newCard(bob)
    await comment(ann, id)
    await move(ann, id)
    expect(await inbox(bob, id)).toEqual(['assigned', 'moved'])
    expect(await queued(id)).toEqual(['assigned'])
    await owner_`delete from push_messages m using notifications n where n.id = m.notification_id and n.user_id = ${bob.id}`
    await auth`update user_sessions set revoked_at = now() where id = ${sid}`
    await setPrefs(bob, {})
  })

  it('email off: left out of the digest', async () => {
    await auth`update users set digest_enabled = true, email_verified_at = now() where id = ${cid.id}`
    await setPrefs(cid, { moved: { email: false } })
    const id = await newCard(cid)
    await move(ann, id)
    expect(await inbox(cid, id)).toEqual(['assigned', 'moved'])
    const [row] = await auth`select * from app.claim_digests() where user_id = ${cid.id}`
    expect(row!.items.map((i: { kind: string }) => i.kind)).toEqual(['assigned'])
    await auth`update users set digest_enabled = false where id = ${cid.id}`
    await setPrefs(cid, {})
  })
})

describe('watched cards', () => {
  it('notify_watching off: watched cards stay quiet, assigned cards and mentions do not', async () => {
    await setPrefs(ann, {}, false)
    // Ann created both, so she watches both; she is assigned only to the second.
    const watched = await newCard(bob)
    const assigned = await newCard(bob, ann)
    for (const id of [watched, assigned]) {
      await comment(bob, id)
      await move(bob, id)
    }
    expect(await inbox(ann, watched)).toEqual([])
    expect(await inbox(ann, assigned)).toEqual(['commented', 'moved'])
    await comment(bob, watched, `hey ${mention(ann)}`)
    expect(await inbox(ann, watched)).toEqual(['commented'])
    await setPrefs(ann, {})
  })
})

describe('board level', () => {
  it('direct: only mentions and being assigned; none: nothing', async () => {
    await setLevel(bob, 'direct')
    const id = await newCard(bob)
    await comment(ann, id)
    await comment(ann, id, `ping ${mention(bob)}`)
    await move(ann, id)
    expect(await inbox(bob, id)).toEqual(['assigned', 'commented'])

    await setLevel(bob, 'none')
    const id2 = await newCard(bob)
    await comment(ann, id2, `ping ${mention(bob)}`)
    expect(await inbox(bob, id2)).toEqual([])

    await setLevel(bob, null)
    await comment(ann, id2)
    expect(await inbox(bob, id2)).toEqual(['commented'])
  })

  it('rows are personal and need the board', async () => {
    await setLevel(bob, 'direct')
    expect(await as(cid.id, sql => sql`select * from board_notification_settings where board_id = ${boardId}`)).toHaveLength(0)
    expect(await as(bob.id, sql => sql`select level from board_notification_settings where board_id = ${boardId}`)).toEqual([{ level: 'direct' }])
    await rejectsWith(as(cid.id, sql => sql`insert into board_notification_settings (user_id, board_id, level) values (${bob.id}, ${boardId}, 'none')`), '42501')
    await rejectsWith(as(eve.id, sql => sql`insert into board_notification_settings (user_id, board_id, level) values (${eve.id}, ${boardId}, 'none')`), '42501')
    expect((await as(cid.id, sql => sql`update board_notification_settings set level = 'none' where user_id = ${bob.id}`)).count).toBe(0)
    expect((await as(cid.id, sql => sql`delete from board_notification_settings where user_id = ${bob.id}`)).count).toBe(0)
    await setLevel(bob, null)
  })
})
