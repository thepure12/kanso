// API tokens and board webhooks: RLS, token resolution and the webhook outbox.
import { createHash, randomUUID } from 'node:crypto'
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

const created: string[] = []
async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  created.push(u!.id)
  return u as { id: string, email: string }
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex')

async function newToken(userId: string, opts: { scopes?: string[], expires?: string | null } = {}) {
  const token = `kb_${randomUUID()}`
  const [row] = await as(userId, sql => sql`
    insert into api_tokens (user_id, name, token_hash, prefix, scopes, expires_at)
    values (${userId}, 'test', ${sha(token)}, ${token.slice(0, 10)}, ${opts.scopes ?? ['read']}, ${opts.expires ?? null})
    returning id`)
  return { token, id: row!.id as string }
}

const resolve = async (token: string) => (await auth`select * from app.resolve_api_token(${sha(token)})`)[0]

type User = { id: string, email: string }
let owner: User, editor: User, outsider: User
let boardId: string
let todoId: string
let doneId: string

beforeAll(async () => {
  ;[owner, editor, outsider] = await Promise.all(['owner', 'editor', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Webhook board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
  })
})

afterAll(async () => {
  await as(owner.id, sql => sql`delete from boards where id = ${boardId}`)
  await owner_`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner_.end()])
})

describe('api tokens', () => {
  it('users see and revoke only their own tokens; nobody reads token_hash', async () => {
    const { id } = await newToken(owner.id)
    expect(await as(owner.id, sql => sql`select id, prefix, scopes from api_tokens where id = ${id}`)).toHaveLength(1)
    expect(await as(outsider.id, sql => sql`select id from api_tokens where id = ${id}`)).toHaveLength(0)
    await rejectsWith(as(owner.id, sql => sql`select token_hash from api_tokens`), '42501')
    await rejectsWith(auth`select id from api_tokens`, '42501')
    expect(await as(outsider.id, sql => sql`update api_tokens set revoked_at = now() where id = ${id} returning id`)).toHaveLength(0)
    expect(await as(owner.id, sql => sql`update api_tokens set revoked_at = now() where id = ${id} returning id`)).toHaveLength(1)
    // Never un-revoked, and nothing else changes.
    expect(await as(owner.id, sql => sql`update api_tokens set revoked_at = null where id = ${id} returning id`)).toHaveLength(0)
    await rejectsWith(as(owner.id, sql => sql`update api_tokens set scopes = '{read,write}' where id = ${id}`), '42501')
  })

  it('users cannot create tokens for someone else; scopes are checked', async () => {
    await rejectsWith(as(outsider.id, sql => sql`
      insert into api_tokens (user_id, name, token_hash, prefix, scopes) values (${owner.id}, 'x', ${sha(randomUUID())}, 'kb_x', '{write}')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`
      insert into api_tokens (user_id, name, token_hash, prefix, scopes, revoked_at) values (${owner.id}, 'x', ${sha(randomUUID())}, 'kb_x', '{read}', now())`), '42501')
    await rejectsWith(newToken(owner.id, { scopes: ['admin'] }), '23514')
    await rejectsWith(newToken(owner.id, { scopes: [] }), '23514')
  })

  it('resolves live tokens only, bumping last_used_at', async () => {
    const live = await newToken(owner.id, { scopes: ['read', 'write'] })
    expect(await resolve(live.token)).toMatchObject({ token_id: live.id, user_id: owner.id, scopes: ['read', 'write'] })
    const [row] = await as(owner.id, sql => sql`select last_used_at from api_tokens where id = ${live.id}`)
    expect(row!.last_used_at).not.toBeNull()

    expect(await resolve('kb_nope')).toBeUndefined()
    const expired = await newToken(owner.id, { expires: new Date(Date.now() - 1000).toISOString() })
    expect(await resolve(expired.token)).toBeUndefined()
    const revoked = await newToken(owner.id)
    await as(owner.id, sql => sql`update api_tokens set revoked_at = now() where id = ${revoked.id}`)
    expect(await resolve(revoked.token)).toBeUndefined()
  })

  it('only kanban_auth resolves and revokes all; a password reset revokes them', async () => {
    const t = await newToken(editor.id)
    await rejectsWith(as(editor.id, sql => sql`select * from app.resolve_api_token(${sha(t.token)})`), '42501')
    await rejectsWith(as(editor.id, sql => sql`select app.revoke_api_tokens(${editor.id})`), '42501')
    await auth`select app.revoke_api_tokens(${editor.id})`
    expect(await resolve(t.token)).toBeUndefined()
  })

  it('deleting the user deletes their tokens', async () => {
    const u = await createUser('gone')
    const t = await newToken(u.id)
    await as(u.id, sql => sql`select app.delete_my_account()`)
    expect(await resolve(t.token)).toBeUndefined()
    expect(await owner_`select 1 from api_tokens where id = ${t.id}`).toHaveLength(0)
    await owner_`delete from admin_audit_log where action = 'user.delete_self' and data ->> 'target_email' = ${u.email}`
  })
})

describe('webhooks', () => {
  const add = (userId: string, events: string[] = [], url = 'http://203.0.113.1/hook') => as(userId, sql => sql`
    insert into board_webhooks (board_id, url, format, secret, events, created_by)
    values (${boardId}, ${url}, 'json', 's3cret', ${events}, ${userId}) returning id`).then(r => r[0]!.id as string)

  const newCard = () => as(owner.id, async (sql) => {
    const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'Card', 1, ${owner.id}) returning id`
    return c!.id as string
  })

  /** Queued deliveries of a webhook, as kinds in order (owner role: the outbox has no grants). */
  const queued = async (webhookId: string) => (await owner_`
    select a.kind from webhook_deliveries d join card_activity a on a.id = d.activity_id
    where d.webhook_id = ${webhookId} order by a.created_at, a.id`).map(r => r.kind as string)

  it('owners manage webhooks; editors and outsiders see nothing; the secret is write-only', async () => {
    const id = await add(owner.id)
    await rejectsWith(add(editor.id), '42501')
    expect(await as(editor.id, sql => sql`select id from board_webhooks where id = ${id}`)).toHaveLength(0)
    expect(await as(outsider.id, sql => sql`select id from board_webhooks where id = ${id}`)).toHaveLength(0)
    expect(await as(editor.id, sql => sql`update board_webhooks set active = false where id = ${id} returning id`)).toHaveLength(0)
    expect(await as(editor.id, sql => sql`delete from board_webhooks where id = ${id} returning id`)).toHaveLength(0)
    await rejectsWith(as(owner.id, sql => sql`select secret from board_webhooks where id = ${id}`), '42501')
    await rejectsWith(as(owner.id, sql => sql`update board_webhooks set failure_count = 0 where id = ${id}`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select * from webhook_deliveries`), '42501')
    expect(await as(owner.id, sql => sql`update board_webhooks set active = false where id = ${id} returning id`)).toHaveLength(1)
    // The ping target (with the secret) is for owners only.
    expect(await as(owner.id, sql => sql`select secret from app.webhook_ping_target(${id})`)).toEqual([{ secret: 's3cret' }])
    expect(await as(editor.id, sql => sql`select * from app.webhook_ping_target(${id})`)).toHaveLength(0)
    expect(await as(owner.id, sql => sql`delete from board_webhooks where id = ${id} returning id`)).toHaveLength(1)
  })

  it('new webhooks start without delivery history', async () => {
    const [h] = await as(owner.id, sql => sql`
      insert into board_webhooks (board_id, url, secret, created_by, failure_count, last_status, last_error)
      values (${boardId}, 'http://203.0.113.1/x', 's', ${owner.id}, 19, 200, 'x') returning id, failure_count, last_status, last_error`)
    expect(h).toMatchObject({ failure_count: 0, last_status: null, last_error: null })
    await as(owner.id, sql => sql`delete from board_webhooks where id = ${h!.id}`)
  })

  it('queues a delivery per matching activity for active webhooks', async () => {
    const all = await add(owner.id)
    const moves = await add(owner.id, ['moved'])
    const off = await add(owner.id)
    await as(owner.id, sql => sql`update board_webhooks set active = false where id = ${off}`)
    const card = await newCard()
    await as(editor.id, sql => sql`update cards set column_id = ${doneId}, title = 'Renamed' where id = ${card}`)
    expect(await queued(all)).toEqual(['created', 'moved', 'renamed'])
    expect(await queued(moves)).toEqual(['moved'])
    expect(await queued(off)).toEqual([])
    await as(owner.id, sql => sql`delete from board_webhooks where id in (${all}, ${moves}, ${off})`)
  })

  it('archived boards and boards created in the same transaction queue nothing', async () => {
    const hook = await add(owner.id)
    const card = await newCard()
    await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    await owner_`update cards set title = 'Archived edit' where id = ${card}`
    await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
    expect(await queued(hook)).toEqual(['created'])

    const copied = await as(owner.id, async (sql) => {
      return (await sql`select id from app.copy_board(${boardId}, 'Copy', null, true)`)[0]!.id as string
    })
    expect((await owner_`select count(*)::int as n from webhook_deliveries d join card_activity a on a.id = d.activity_id where a.board_id = ${copied}`)[0]!.n).toBe(0)
    await as(owner.id, sql => sql`delete from boards where id = ${copied}`)
    await as(owner.id, sql => sql`delete from board_webhooks where id = ${hook}`)
  })

  it('claims, retries with backoff, fails after 5 attempts and turns off after 20 failures in a row', async () => {
    const hook = await add(owner.id, ['renamed'])
    const card = await newCard()
    await as(owner.id, sql => sql`update cards set title = 'Ping' where id = ${card}`)
    await rejectsWith(as(owner.id, sql => sql`select * from app.claim_webhook_deliveries(10)`), '42501')

    const [d] = await owner_`select id from webhook_deliveries where webhook_id = ${hook}`
    const claimFor = async () => {
      await owner_`update webhook_deliveries set next_attempt_at = now() - interval '1 second' where id = ${d!.id}`
      const rows = await auth`select * from app.claim_webhook_deliveries(1000)`
      return rows.find(r => r.delivery_id === d!.id)
    }
    const claimed = await claimFor()
    expect(claimed).toMatchObject({ webhook_id: hook, url: 'http://203.0.113.1/hook', format: 'json', secret: 's3cret', attempt: 1, kind: 'renamed', card_title: 'Ping', board_name: 'Webhook board', actor_name: 'owner', locale: null })
    // Leased: not handed out again right away.
    expect((await auth`select * from app.claim_webhook_deliveries(1000)`).some(r => r.delivery_id === d!.id)).toBe(false)

    await auth`select app.finish_webhook_delivery(${d!.id}, false, 500, 'HTTP 500')`
    let [state] = await owner_`select status, next_attempt_at > now() + interval '50 seconds' as later from webhook_deliveries where id = ${d!.id}`
    expect(state).toMatchObject({ status: 'pending', later: true })
    let [w] = await as(owner.id, sql => sql`select last_status, last_error, failure_count, active from board_webhooks where id = ${hook}`)
    expect(w).toMatchObject({ last_status: 500, last_error: 'HTTP 500', failure_count: 1, active: true })

    for (let i = 2; i <= 5; i++) {
      expect((await claimFor())?.attempt).toBe(i)
      await auth`select app.finish_webhook_delivery(${d!.id}, false, null, 'Timed out')`
    }
    ;[state] = await owner_`select status from webhook_deliveries where id = ${d!.id}`
    expect(state!.status).toBe('failed')
    expect(await claimFor()).toBeUndefined()

    // A success resets the count; 20 failures in a row turn the webhook off.
    await auth`select app.record_webhook_result(${hook}, true, 200, null, true)`
    for (let i = 0; i < 19; i++) await auth`select app.record_webhook_result(${hook}, false, 500, 'HTTP 500', true)`
    ;[w] = await as(owner.id, sql => sql`select failure_count, active from board_webhooks where id = ${hook}`)
    expect(w).toMatchObject({ failure_count: 19, active: true })
    // Test pings are not counted.
    await auth`select app.record_webhook_result(${hook}, false, 500, 'HTTP 500', false)`
    await auth`select app.record_webhook_result(${hook}, false, 500, 'HTTP 500', true)`
    ;[w] = await as(owner.id, sql => sql`select failure_count, active from board_webhooks where id = ${hook}`)
    expect(w).toMatchObject({ failure_count: 20, active: false })
    // Turning it back on starts afresh.
    ;[w] = await as(owner.id, sql => sql`update board_webhooks set active = true where id = ${hook} returning failure_count`)
    expect(w!.failure_count).toBe(0)
    await as(owner.id, sql => sql`delete from board_webhooks where id = ${hook}`)
  })

  it('delivery functions are not callable by kanban_app', async () => {
    await rejectsWith(as(owner.id, sql => sql`select app.finish_webhook_delivery(${randomUUID()}, true, 200, null)`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select app.record_webhook_result(${randomUUID()}, true, 200, null, false)`), '42501')
  })
})
