// Account self-service and the email digest: delete_my_account, column grants
// on users, invites claimed after an email change, claim_digests. Same setup
// as admin.test.ts; created users are deleted at the end as the owner role.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { allowExternalInvites } from './helpers/settings'

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

const newEmail = (name: string) => `${name}-${randomUUID()}@test.local`
const created: string[] = []
const emails: string[] = []

type User = { id: string, email: string }
async function createUser(name: string, email = newEmail(name), verified = true): Promise<User> {
  const [u] = await auth`insert into users (email, name, email_verified_at) values (${email}, ${name}, ${verified ? new Date() : null}) returning id, email`
  created.push(u!.id)
  emails.push(email)
  return u as User
}

// The email-change test invites an outside email; a dev database may have that turned off.
let restoreSettings: () => Promise<void>
beforeAll(async () => { restoreSettings = await allowExternalInvites(owner) })

afterAll(async () => {
  await restoreSettings?.()
  await owner`delete from admin_audit_log where actor_id = any(${created}) or target_user_id = any(${created})
    or data->>'actor_email' = any(${emails}) or data->>'target_email' = any(${emails})`
  await owner`delete from boards where id in (select board_id from board_members where user_id = any(${created}))`
  await owner`delete from teams where id in (select team_id from team_members where user_id = any(${created}))`
  await owner`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('delete_my_account', () => {
  it('hands over shared boards, deletes empty ones and the user', async () => {
    const leaver = await createUser('leaver')
    const heir = await createUser('heir')
    const { shared, alone } = await as(leaver.id, async (sql) => {
      const [{ id: shared }] = await sql`select id from app.create_board('Shared', null)` as any
      const [{ id: alone }] = await sql`select id from app.create_board('Alone', null)` as any
      await sql`select app.add_board_member(${shared}, ${heir.email}, 'editor')`
      return { shared, alone }
    })
    await as(leaver.id, sql => sql`select app.delete_my_account()`)
    const [state] = await owner`select
      (select role from board_members where board_id = ${shared} and user_id = ${heir.id}) as heir_role,
      (select count(*)::int from boards where id = ${alone}) as alone,
      (select count(*)::int from users where id = ${leaver.id}) as users` as any
    expect(state).toEqual({ heir_role: 'owner', alone: 0, users: 0 })
  })

  it('refuses the last admin', async () => {
    const admin = await createUser('admin')
    await auth`select app.bootstrap_admin(${admin.id}, ${admin.email})`
    // Other admins in the dev database: remove them in a transaction that rolls back.
    await rejectsWith(owner.begin(async (sql) => {
      await sql`delete from instance_admins where user_id <> ${admin.id}`
      await sql`select set_config('app.user_id', ${admin.id}, true)`
      await sql`select app.delete_my_account()`
    }), 'KB002')
    expect(await owner`select 1 from users where id = ${admin.id}`).toHaveLength(1)
  })

  it('kanban_app cannot call the internal helper or the digest claim', async () => {
    const u = await createUser('plain')
    await rejectsWith(as(u.id, sql => sql`select app.remove_user_internal(${u.id})`), '42501')
    await rejectsWith(as(u.id, sql => sql`select * from app.claim_digests()`), '42501')
  })
})

describe('users column grants', () => {
  it('reads its session version and toggles only its own digest', async () => {
    const [me, other] = [await createUser('me'), await createUser('other')]
    await as(me.id, sql => sql`select id from app.create_board('Shared', null)`).then(async ([b]) => {
      await as(me.id, sql => sql`select app.add_board_member(${b!.id}, ${other.email}, 'viewer')`)
    })
    const [row] = await as(me.id, sql => sql`select session_version from users where id = ${me.id}`)
    expect(row!.session_version).toBe(0)
    expect((await as(me.id, sql => sql`update users set digest_enabled = true where id = ${me.id}`)).count).toBe(1)
    expect((await as(me.id, sql => sql`update users set digest_enabled = true where id = ${other.id}`)).count).toBe(0)
    await rejectsWith(as(me.id, sql => sql`update users set session_version = 5 where id = ${me.id}`), '42501')
    await rejectsWith(as(me.id, sql => sql`update users set digest_sent_at = now() where id = ${me.id}`), '42501')
  })

  it('sets only its own language, to a known locale or null', async () => {
    const [me, other] = [await createUser('me'), await createUser('other')]
    expect((await as(me.id, sql => sql`update users set locale = 'de' where id = ${me.id} returning locale`))[0]!.locale).toBe('de')
    expect((await as(me.id, sql => sql`update users set locale = 'de' where id = ${other.id}`)).count).toBe(0)
    await rejectsWith(as(me.id, sql => sql`update users set locale = 'xx' where id = ${me.id}`), '23514')
    expect((await as(me.id, sql => sql`update users set locale = null where id = ${me.id}`)).count).toBe(1)
  })
})

describe('email change', () => {
  it('claims invites sent to the new address', async () => {
    const boardOwner = await createUser('owner')
    const mover = await createUser('mover')
    const target = newEmail('new')
    const [board] = await as(boardOwner.id, sql => sql`select id from app.create_board('Invite board', null)`)
    await as(boardOwner.id, sql => sql`select app.add_board_member(${board!.id}, ${target}, 'editor')`)
    await auth`update users set email = ${target}, email_verified_at = now() where id = ${mover.id}`
    const [m] = await owner`select role from board_members where board_id = ${board!.id} and user_id = ${mover.id}`
    expect(m?.role).toBe('editor')
    expect(await owner`select 1 from invites where email = ${target}`).toHaveLength(0)
  })
})

describe('claim_digests', () => {
  let boardOwner: User, reader: User, idle: User, off: User
  let cardId: string

  beforeAll(async () => {
    ;[boardOwner, reader, idle, off] = [await createUser('bo'), await createUser('reader'), await createUser('idle'), await createUser('off')]
    await auth`update users set digest_enabled = true where id = any(${[reader.id, idle.id]})`
    await auth`update users set locale = 'de' where id = ${reader.id}`
    // A board created in the same transaction notifies nobody, so in two steps.
    const [{ id: b }] = await as(boardOwner.id, sql => sql`select id from app.create_board('Digest board', null)`) as any
    cardId = await as(boardOwner.id, async (sql) => {
      for (const u of [reader, idle, off]) await sql`select app.add_board_member(${b}, ${u.email}, 'editor')`
      const [{ id: col }] = await sql`insert into columns (board_id, title, position) values (${b}, 'Todo', 1) returning id` as any
      const [{ id: card }] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${b}, ${col}, 'Digest card', 1, ${boardOwner.id}) returning id` as any
      await sql`insert into card_assignees (card_id, user_id, board_id) values (${card}, ${reader.id}, ${b}), (${card}, ${off.id}, ${b})`
      return card
    })
  })

  const claim = async () => (await auth`select * from app.claim_digests()`)
    .filter(r => [reader.id, idle.id, off.id].includes(r.user_id))

  it('returns opted-in users with unread notifications, once per day', async () => {
    const rows = await claim()
    expect(rows.map(r => r.user_id)).toEqual([reader.id])
    expect(rows[0]!.locale).toBe('de')
    expect(rows[0]!.items).toEqual([expect.objectContaining({ cardId, cardTitle: 'Digest card', kind: 'assigned', actorName: 'bo' })])
    expect(await claim()).toEqual([])
    // Idle had nothing to report but is claimed for today too.
    const [idleRow] = await owner`select digest_sent_at from users where id = ${idle.id}`
    expect(idleRow!.digest_sent_at).not.toBeNull()
  })

  it('next day: only notifications since the previous digest', async () => {
    // Pretend the first digest and its notification were from yesterday.
    await owner`update notifications set created_at = now() - interval '2 days' where user_id = ${reader.id}`
    await owner`update users set digest_sent_at = now() - interval '1 day' where id = ${reader.id}`
    expect(await claim()).toEqual([])
    await owner`update users set digest_sent_at = now() - interval '1 day' where id = ${reader.id}`
    await as(boardOwner.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) select ${cardId}, board_id, ${boardOwner.id}, 'ping' from cards where id = ${cardId}`)
    const rows = await claim()
    expect(rows[0]!.items.map((i: { kind: string }) => i.kind)).toEqual(['commented'])
  })
})
