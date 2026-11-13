// Web Push: subscription RLS, session binding and the push_messages outbox (0068_push_rls.sql).
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

type User = { id: string, email: string }

async function createUser(name: string): Promise<User> {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  return u as User
}

async function newSession(u: User) {
  const [s] = await auth`insert into user_sessions (user_id, user_agent, ip) values (${u.id}, 'test-agent', '10.0.0.1') returning id`
  return s!.id as string
}

// Example endpoint on a documentation address: nothing is ever sent there.
const endpoint = () => `https://push.example.test/${randomUUID()}`
const p256dh = () => randomBytes(65).toString('base64url')
const authKey = () => randomBytes(16).toString('base64url')

const save = (u: User, sid: string | null, ep: string) =>
  as(u.id, async sql => (await sql`select app.save_push_subscription(${sid}::uuid, ${ep}, ${p256dh()}, ${authKey()}, 'test-agent') as id`)[0]!.id as string)

const mine = (u: User) => as(u.id, sql => sql`select id, endpoint from push_subscriptions order by created_at`)

let ann: User, bob: User, eve: User
let annSession: string, bobSession: string
let boardId: string, columnId: string

beforeAll(async () => {
  ;[ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map(createUser))
  ;[annSession, bobSession] = await Promise.all([newSession(ann!), newSession(bob!)])
  await as(ann!.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Push board')` as any
    ;[{ id: columnId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${bob!.email}, 'editor')`
  })
})

afterAll(async () => {
  await as(ann.id, sql => sql`delete from boards where id = ${boardId}`)
  await owner_`delete from users where id in ${owner_([ann.id, bob.id, eve.id])}`
  await Promise.all([app.end(), auth.end(), owner_.end()])
})

describe('push_subscriptions', () => {
  it('saves only for a live session of the caller', async () => {
    await rejectsWith(save(ann, null, endpoint()), '42501')
    await rejectsWith(save(ann, bobSession, endpoint()), '42501')
    const revoked = await newSession(ann)
    await auth`update user_sessions set revoked_at = now() where id = ${revoked}`
    await rejectsWith(save(ann, revoked, endpoint()), '42501')
  })

  it('users see and delete only their own rows, never the keys', async () => {
    const ep = endpoint()
    const id = await save(ann, annSession, ep)
    expect((await mine(ann)).map(r => r.endpoint)).toContain(ep)
    expect(await mine(bob)).toEqual([])
    await rejectsWith(as(ann.id, sql => sql`select p256dh from push_subscriptions`), '42501')
    await rejectsWith(as(ann.id, sql => sql`select auth from push_subscriptions`), '42501')
    await rejectsWith(as(ann.id, sql => sql`insert into push_subscriptions (user_id, session_id, endpoint, p256dh, auth) values (${ann.id}, ${annSession}, ${endpoint()}, ${p256dh()}, ${authKey()})`), '42501')
    await rejectsWith(as(ann.id, sql => sql`update push_subscriptions set endpoint = ${endpoint()} where id = ${id}`), '42501')
    expect(await as(bob.id, sql => sql`delete from push_subscriptions where id = ${id} returning id`)).toHaveLength(0)
    expect(await as(ann.id, sql => sql`delete from push_subscriptions where id = ${id} returning id`)).toHaveLength(1)
  })

  it('an endpoint moves to whoever signs in on that browser next', async () => {
    const ep = endpoint()
    const first = await save(ann, annSession, ep)
    const second = await save(bob, bobSession, ep)
    expect(second).toBe(first)
    expect((await mine(ann)).map(r => r.endpoint)).not.toContain(ep)
    expect((await mine(bob)).map(r => r.endpoint)).toContain(ep)
    await as(bob.id, sql => sql`delete from push_subscriptions where id = ${second}`)
  })

  it('my_push_targets returns only the caller\'s keys', async () => {
    const ep = endpoint()
    await save(ann, annSession, ep)
    const own = await as(ann.id, sql => sql`select * from app.my_push_targets(${ep})`)
    expect(own).toHaveLength(1)
    expect(own[0]!.p256dh).toBeTruthy()
    expect(await as(bob.id, sql => sql`select * from app.my_push_targets(${ep})`)).toHaveLength(0)
    await as(ann.id, sql => sql`delete from push_subscriptions where endpoint = ${ep}`)
  })

  it('revoking the session deletes its subscriptions', async () => {
    const sid = await newSession(eve)
    const ep = endpoint()
    await save(eve, sid, ep)
    await auth`update user_sessions set revoked_at = now() where id = ${sid}`
    expect(await mine(eve)).toEqual([])
  })

  it('keeps the newest 20 per user', async () => {
    const sid = await newSession(eve)
    for (let i = 0; i < 22; i++) await save(eve, sid, endpoint())
    expect(await mine(eve)).toHaveLength(20)
    await as(eve.id, sql => sql`delete from push_subscriptions`)
  })
})

describe('push_messages', () => {
  it('kanban_app cannot touch the outbox or the sender functions', async () => {
    await rejectsWith(as(ann.id, sql => sql`select * from push_messages`), '42501')
    await rejectsWith(as(ann.id, sql => sql`select * from app.claim_push_messages(10)`), '42501')
    await rejectsWith(as(ann.id, sql => sql`select app.record_push_result(${randomUUID()}, true, false)`), '42501')
  })

  it('queues one message per notification of a subscribed user and hands it out once', async () => {
    const ep = endpoint()
    const subId = await save(bob, bobSession, ep)
    // Keep the message from being due at commit, in the same transaction: a dev
    // server on this database would claim it as soon as the NOTIFY arrives.
    const cardId = await owner_.begin(async (sql) => {
      await sql`select set_config('app.user_id', ${ann.id}, true)`
      const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'Push card', 1, ${ann.id}) returning id`
      await sql`insert into card_assignees (card_id, user_id, board_id) values (${c!.id}, ${bob.id}, ${boardId})`
      await sql`insert into card_assignees (card_id, user_id, board_id) values (${c!.id}, ${ann.id}, ${boardId})`
      await sql`update push_messages m set next_attempt_at = now() + interval '1 day'
        from notifications n where n.id = m.notification_id and n.card_id = ${c!.id}`
      return c!.id as string
    })
    // Bob (subscribed) gets a message for his notification, Ann (no subscription) none.
    const queued = await owner_`select n.user_id from push_messages m join notifications n on n.id = m.notification_id where n.card_id = ${cardId}`
    expect(queued.map(r => r.user_id)).toEqual([bob.id])

    const claimed = await owner_.begin(async (sql) => {
      await sql`update push_messages m set next_attempt_at = now() - interval '1 second'
        from notifications n where n.id = m.notification_id and n.card_id = ${cardId}`
      return (await sql`select * from app.claim_push_messages(1000)`).find(r => r.card_id === cardId)
    })
    expect(claimed).toMatchObject({ user_id: bob.id, read: false, kind: 'assigned', card_title: 'Push card', board_name: 'Push board', actor_name: 'ann' })
    expect(claimed!.subscriptions).toEqual([expect.objectContaining({ id: subId, endpoint: ep })])
    // Leased: not handed out again right away.
    expect((await auth`select * from app.claim_push_messages(1000)`).some(r => r.message_id === claimed!.message_id)).toBe(false)
    await auth`select app.finish_push_message(${claimed!.message_id})`
    expect(await owner_`select 1 from push_messages where id = ${claimed!.message_id}`).toHaveLength(0)

    // Results: success resets, gone deletes.
    await auth`select app.record_push_result(${subId}, false, false)`
    expect((await owner_`select failure_count from push_subscriptions where id = ${subId}`)[0]!.failure_count).toBe(1)
    await auth`select app.record_push_result(${subId}, true, false)`
    expect((await owner_`select failure_count, last_success_at is not null as ok from push_subscriptions where id = ${subId}`)[0]).toMatchObject({ failure_count: 0, ok: true })
    await auth`select app.record_push_result(${subId}, false, true)`
    expect(await mine(bob)).toEqual([])
  })
})
