// Two-factor storage, signed-in sessions and the admin audit log. Same setup
// as admin.test.ts. Settings are one global row: saved and restored here.
// Created users and their audit entries are deleted at the end as the owner role.
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

/** As kanban_auth with app.user_id set (how requireLiveSession calls check_session). */
function authAs<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return auth.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

const created: string[] = []
const emails: string[] = []

type User = { id: string, email: string }
async function createUser(name: string): Promise<User> {
  const email = `${name}-${randomUUID()}@test.local`
  const [u] = await auth`insert into users (email, name, email_verified_at) values (${email}, ${name}, now()) returning id, email`
  created.push(u!.id)
  emails.push(email)
  return u as User
}

async function newSession(u: User) {
  const [s] = await auth`insert into user_sessions (user_id, user_agent, ip) values (${u.id}, 'test-agent', '10.0.0.1') returning id`
  return s!.id as string
}

const checkSession = async (u: User, sid: string | null, version = 0) =>
  (await as(u.id, sql => sql`select app.check_session(${sid}::uuid, ${version}) as s`))[0]!.s

let admin: User
let saved: Record<string, unknown>

beforeAll(async () => {
  ;[saved] = await owner`select signup_mode, allowed_domains, allowed_emails, allow_external_invites from instance_settings` as any
  admin = await createUser('admin')
  await auth`select app.bootstrap_admin(${admin.id}, ${admin.email})`
})

afterAll(async () => {
  await as(admin.id, sql => sql`update instance_settings set ${sql(saved)}`)
  await owner`delete from admin_audit_log where actor_id = any(${created}) or target_user_id = any(${created})
    or data->>'actor_email' = any(${emails}) or data->>'target_email' = any(${emails})`
  await owner`delete from boards where id in (select board_id from board_members where user_id = any(${created}))`
  await owner`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('two-factor tables', () => {
  it('are invisible to kanban_app and usable by kanban_auth', async () => {
    const u = await createUser('totp')
    await auth`insert into user_totp (user_id, secret_enc, enabled_at) values (${u.id}, 'v1.x.y.z', now())`
    await auth`insert into user_recovery_codes (user_id, code_hash) values (${u.id}, 'abc')`
    expect(await auth`select user_id from user_totp where user_id = ${u.id}`).toHaveLength(1)
    for (const table of ['user_totp', 'user_recovery_codes']) {
      await rejectsWith(as(u.id, sql => sql`select * from ${sql(table)}`), '42501')
      await rejectsWith(as(u.id, sql => sql`delete from ${sql(table)} where user_id = ${u.id}`), '42501')
    }
    await rejectsWith(as(u.id, sql => sql`insert into user_totp (user_id, secret_enc) values (${u.id}, 'x')`), '42501')
    await rejectsWith(as(u.id, sql => sql`update user_totp set enabled_at = null`), '42501')
  })

  it('go with the account', async () => {
    const u = await createUser('totp-gone')
    await auth`insert into user_totp (user_id, secret_enc) values (${u.id}, 'x')`
    await owner`delete from users where id = ${u.id}`
    expect(await owner`select 1 from user_totp where user_id = ${u.id}`).toHaveLength(0)
  })
})

describe('user sessions', () => {
  it('users see and revoke only their own, and cannot un-revoke or create', async () => {
    const [ann, ben] = [await createUser('ann'), await createUser('ben')]
    const [a1, a2, b1] = [await newSession(ann), await newSession(ann), await newSession(ben)]
    const mine = await as(ann.id, sql => sql`select id, user_agent, ip from user_sessions`)
    expect(mine.map(r => r.id).sort()).toEqual([a1, a2].sort())
    expect(mine[0]).toMatchObject({ user_agent: 'test-agent', ip: '10.0.0.1' })

    expect(await as(ann.id, sql => sql`update user_sessions set revoked_at = now() where id = ${b1} returning id`)).toHaveLength(0)
    expect(await as(ann.id, sql => sql`update user_sessions set revoked_at = now() where id = ${a2} returning id`)).toHaveLength(1)
    // A revoked row stays revoked; a live one cannot be "revoked" to null.
    expect(await as(ann.id, sql => sql`update user_sessions set revoked_at = null where id = ${a2} returning id`)).toHaveLength(0)
    await rejectsWith(as(ann.id, sql => sql`update user_sessions set revoked_at = null where id = ${a1}`), '42501')
    // Only revoked_at is writable.
    await rejectsWith(as(ann.id, sql => sql`update user_sessions set last_seen_at = now() where id = ${a1}`), '42501')
    await rejectsWith(as(ann.id, sql => sql`insert into user_sessions (user_id) values (${ann.id})`), '42501')
    await rejectsWith(as(ann.id, sql => sql`delete from user_sessions where id = ${a1}`), '42501')
  })

  it('check_session: live row and matching version only', async () => {
    const [cat, dan] = [await createUser('cat'), await createUser('dan')]
    const sid = await newSession(cat)
    expect(await checkSession(cat, sid)).toBe('ok')
    expect(await checkSession(cat, sid, 1)).toBe('expired')
    // Sessions from before session rows existed have no id.
    expect(await checkSession(cat, null)).toBe('expired')
    expect(await checkSession(cat, randomUUID())).toBe('expired')
    // Someone else's session id does not count.
    expect(await checkSession(dan, sid)).toBe('expired')
    expect(await checkSession({ id: randomUUID(), email: '' }, sid)).toBe('gone')
    expect((await authAs(cat.id, sql => sql`select app.check_session(${sid}, 0) as s`))[0]!.s).toBe('ok')

    await as(cat.id, sql => sql`update user_sessions set revoked_at = now() where id = ${sid}`)
    expect(await checkSession(cat, sid)).toBe('expired')
  })

  it('check_session moves last_seen_at at most every 5 minutes', async () => {
    const u = await createUser('seen')
    const sid = await newSession(u)
    await owner`update user_sessions set last_seen_at = now() - interval '2 minutes' where id = ${sid}`
    await checkSession(u, sid)
    const [{ fresh }] = await owner`select last_seen_at > now() - interval '1 minute' as fresh from user_sessions where id = ${sid}` as any
    expect(fresh).toBe(false)
    await owner`update user_sessions set last_seen_at = now() - interval '10 minutes' where id = ${sid}`
    await checkSession(u, sid)
    const [{ fresh: after }] = await owner`select last_seen_at > now() - interval '1 minute' as fresh from user_sessions where id = ${sid}` as any
    expect(after).toBe(true)
  })

  it('a session version bump revokes every session of the user', async () => {
    const [eve, fay] = [await createUser('eve'), await createUser('fay')]
    const [e1, e2, f1] = [await newSession(eve), await newSession(eve), await newSession(fay)]
    await auth`update users set session_version = session_version + 1 where id = ${eve.id}`
    const rows = await owner`select id, revoked_at is not null as revoked from user_sessions where id = any(${[e1, e2, f1]})`
    expect(Object.fromEntries(rows.map(r => [r.id, r.revoked]))).toEqual({ [e1]: true, [e2]: true, [f1]: false })
    // Other updates leave sessions alone.
    const e3 = await newSession(eve)
    await auth`update users set name = 'Eve' where id = ${eve.id}`
    expect(await checkSession(eve, e3, 1)).toBe('ok')
  })
})

describe('admin audit log', () => {
  const entries = (actor: string) => owner`select action, actor_id, target_user_id, data from admin_audit_log
    where actor_id = ${actor} or target_user_id = ${actor} order by created_at, id`

  it('records the bootstrap, promotions and demotions', async () => {
    const boss = await createUser('boss')
    const helper = await createUser('helper')
    await auth`select app.bootstrap_admin(${boss.id}, ${boss.email})`
    await auth`select app.bootstrap_admin(${boss.id}, ${boss.email})` // already admin: nothing new
    await as(boss.id, sql => sql`insert into instance_admins (user_id) values (${helper.id})`)
    await as(boss.id, sql => sql`delete from instance_admins where user_id = ${helper.id}`)
    const log = await entries(boss.id)
    expect(log.map(e => e.action)).toEqual(['admin.bootstrap', 'admin.promote', 'admin.demote'])
    expect(log[0]).toMatchObject({ actor_id: boss.id, target_user_id: boss.id })
    expect(log[1]).toMatchObject({
      actor_id: boss.id, target_user_id: helper.id,
      data: { actor_email: boss.email, actor_name: 'boss', target_email: helper.email, target_name: 'helper' },
    })
  })

  it('records settings changes, only the fields that changed', async () => {
    await as(admin.id, sql => sql`update instance_settings set signup_mode = 'restricted', allowed_domains = '{}'`)
    await as(admin.id, sql => sql`update instance_settings set allowed_domains = '{audit.test}'`)
    await as(admin.id, sql => sql`update instance_settings set allowed_domains = '{audit.test}'`) // no change
    const [last, ...rest] = (await entries(admin.id)).filter(e => e.action === 'settings.update').reverse()
    expect(last!.data.changes).toEqual({ allowed_domains: { from: [], to: ['audit.test'] } })
    expect(rest.every(e => !('allowed_domains' in e.data.changes) || e.data.changes.allowed_domains.to.length === 0)).toBe(true)
  })

  it('records removals and self-deletion, keeping names after the accounts are gone', async () => {
    const victim = await createUser('victim')
    const leaver = await createUser('leaver')
    await as(admin.id, sql => sql`select app.remove_user(${victim.id})`)
    await as(leaver.id, sql => sql`select app.delete_my_account()`)
    const [removed] = await owner`select * from admin_audit_log where action = 'user.remove' and data->>'target_email' = ${victim.email}`
    expect(removed).toMatchObject({ actor_id: admin.id, target_user_id: null, data: { target_name: 'victim', actor_email: admin.email } })
    const [self] = await owner`select * from admin_audit_log where action = 'user.delete_self' and data->>'target_email' = ${leaver.email}`
    expect(self).toMatchObject({ actor_id: null, target_user_id: null, data: { actor_name: 'leaver', target_name: 'leaver' } })
    // Removing an admin does not also log a demotion.
    const exAdmin = await createUser('exadmin')
    await as(admin.id, sql => sql`insert into instance_admins (user_id) values (${exAdmin.id})`)
    await as(admin.id, sql => sql`select app.remove_user(${exAdmin.id})`)
    const actions = await owner`select action from admin_audit_log where data->>'target_email' = ${exAdmin.email} order by created_at`
    expect(actions.map(a => a.action)).toEqual(['admin.promote', 'user.remove'])
  })

  it('only admins read it; nobody writes it directly', async () => {
    const plain = await createUser('plain')
    expect((await as(admin.id, sql => sql`select id from admin_audit_log`)).length).toBeGreaterThan(0)
    expect(await as(plain.id, sql => sql`select id from admin_audit_log`)).toHaveLength(0)
    await rejectsWith(as(admin.id, sql => sql`insert into admin_audit_log (action) values ('fake')`), '42501')
    await rejectsWith(as(admin.id, sql => sql`delete from admin_audit_log`), '42501')
    await rejectsWith(as(admin.id, sql => sql`select app.log_admin_action(${admin.id}, 'fake', null)`), '42501')
    await rejectsWith(auth`select * from admin_audit_log`, '42501')
    await rejectsWith(auth`select app.log_admin_action(${admin.id}, 'fake', null)`, '42501')
  })
})
