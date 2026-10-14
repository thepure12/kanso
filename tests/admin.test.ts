// RLS tests for instance admins, sign-up settings and account removal. Same
// setup as rls.test.ts. Settings are one global row: saved and restored here.
// Created users are deleted at the end as the owner role, so test admins do not
// linger in the dev database.
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

const domain = `${randomUUID().slice(0, 8)}.test`
const newEmail = (name: string, d = 'test.local') => `${name}-${randomUUID()}@${d}`
const created: string[] = []
const emails: string[] = []

async function createUser(name: string, email = newEmail(name), verified = true) {
  const [u] = await auth`insert into users (email, name, email_verified_at) values (${email}, ${name}, ${verified ? new Date() : null}) returning id, email`
  created.push(u!.id)
  emails.push(email)
  return u as { id: string, email: string }
}

async function makeAdmin(u: { id: string, email: string }) {
  await auth`select app.bootstrap_admin(${u.id}, ${u.email})`
}

async function setSettings(s: { mode?: string, domains?: string[], emails?: string[], external?: boolean }) {
  await as(admin.id, sql => sql`update instance_settings set
    signup_mode = coalesce(${s.mode ?? null}::signup_mode, signup_mode),
    allowed_domains = coalesce(${s.domains ?? null}::text[], allowed_domains),
    allowed_emails = coalesce(${s.emails ?? null}::text[], allowed_emails),
    allow_external_invites = coalesce(${s.external ?? null}::boolean, allow_external_invites)`)
}

const signupAllowed = async (e: string) => (await auth`select app.signup_allowed(${e}) as ok`)[0]!.ok

let admin: { id: string, email: string }
let alice: { id: string, email: string }
let saved: Record<string, unknown>

beforeAll(async () => {
  ;[saved] = await owner`select signup_mode, allowed_domains, allowed_emails, allow_external_invites from instance_settings` as any
  admin = await createUser('admin')
  alice = await createUser('alice')
  await makeAdmin(admin)
})

afterAll(async () => {
  // As the admin, so the audit entry is one of ours and goes below.
  await as(admin.id, sql => sql`update instance_settings set ${sql(saved)}`)
  await owner`delete from admin_audit_log where actor_id = any(${created}) or target_user_id = any(${created})
    or data->>'actor_email' = any(${emails}) or data->>'target_email' = any(${emails})`
  await owner`delete from boards where id in (select board_id from board_members where user_id = any(${created}))`
  await owner`delete from teams where id in (select team_id from team_members where user_id = any(${created}))`
  await owner`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('bootstrap_admin', () => {
  it('admits only a verified account with the given email', async () => {
    const unverified = await createUser('pending', undefined, false)
    await makeAdmin(unverified)
    await auth`select app.bootstrap_admin(${alice.id}, ${'someone-else@test.local'})`
    const isAdmin = async (id: string) => (await as(id, sql => sql`select app.is_admin() as a`))[0]!.a
    expect(await isAdmin(unverified.id)).toBe(false)
    expect(await isAdmin(alice.id)).toBe(false)
    expect(await isAdmin(admin.id)).toBe(true)
  })

  it('is not executable by kanban_app', async () => {
    await rejectsWith(as(alice.id, sql => sql`select app.bootstrap_admin(${alice.id}, ${alice.email})`), '42501')
  })
})

describe('instance settings', () => {
  it('only admins read and update; kanban_auth reads', async () => {
    expect(await as(alice.id, sql => sql`select * from instance_settings`)).toHaveLength(0)
    expect(await as(alice.id, sql => sql`update instance_settings set signup_mode = 'open' returning id`)).toHaveLength(0)
    expect(await as(admin.id, sql => sql`select signup_mode from instance_settings`)).toHaveLength(1)
    expect(await auth`select signup_mode from instance_settings`).toHaveLength(1)
    await rejectsWith(auth`update instance_settings set signup_mode = 'open'`, '42501')
    await rejectsWith(as(admin.id, sql => sql`insert into instance_settings (id) values (true)`), '42501')
  })

  it('signup_allowed follows mode, allowlists and external invites', async () => {
    await setSettings({ mode: 'restricted', domains: [domain], emails: ['vip@elsewhere.test'], external: false })
    expect(await signupAllowed(`Someone@${domain.toUpperCase()}`)).toBe(true)
    expect(await signupAllowed(`a@sub.${domain}`)).toBe(false)
    expect(await signupAllowed('VIP@elsewhere.test')).toBe(true)
    expect(await signupAllowed('nobody@elsewhere.test')).toBe(false)

    // An invite admits an outside email only with external invites on.
    const outsider = newEmail('invited', 'elsewhere.test')
    await setSettings({ external: true })
    await as(alice.id, async (sql) => {
      const [{ id }] = await sql`select id from app.create_board('Gate', null)` as any
      await sql`select app.add_board_member(${id}, ${outsider}, 'viewer')`
    })
    expect(await signupAllowed(outsider)).toBe(true)
    await setSettings({ external: false })
    expect(await signupAllowed(outsider)).toBe(false)

    await setSettings({ mode: 'open' })
    expect(await signupAllowed('anyone@anywhere.test')).toBe(true)
  })

  it('owners cannot invite outside emails when external invites are off', async () => {
    await setSettings({ mode: 'restricted', domains: [domain], emails: [], external: false })
    const existing = await createUser('existing', newEmail('existing', 'elsewhere.test'))
    await as(alice.id, async (sql) => {
      const [{ id: board }] = await sql`select id from app.create_board('Invites', null)` as any
      const [{ id: team }] = await sql`select id from app.create_team('Invites team')` as any
      await rejectsWith(sql.savepoint(s => s`select app.add_board_member(${board}, ${'x@elsewhere.test'}, 'viewer')`), 'KB001')
      await rejectsWith(sql.savepoint(s => s`select app.add_team_member(${team}, ${'x@elsewhere.test'}, 'viewer')`), 'KB001')
      // Allowed domains still get invites, and existing accounts are added as before.
      expect((await sql`select app.add_board_member(${board}, ${`new@${domain}`}, 'viewer') as u`)[0]!.u).toBeNull()
      expect((await sql`select app.add_board_member(${board}, ${existing.email}, 'viewer') as u`)[0]!.u).toBe(existing.id)
    })
  })
})

describe('admins', () => {
  it('see every user; others see only people they share boards with', async () => {
    const stranger = await createUser('stranger')
    expect(await as(admin.id, sql => sql`select id, email_verified_at from users where id = ${stranger.id}`)).toHaveLength(1)
    expect(await as(alice.id, sql => sql`select id from users where id = ${stranger.id}`)).toHaveLength(0)
  })

  it('promote verified users and keep at least one admin', async () => {
    const bob = await createUser('bob')
    const pending = await createUser('pending', undefined, false)
    await rejectsWith(as(alice.id, sql => sql`insert into instance_admins (user_id) values (${bob.id})`), '42501')
    await rejectsWith(as(admin.id, sql => sql`insert into instance_admins (user_id) values (${pending.id})`), '42501')
    await as(admin.id, sql => sql`insert into instance_admins (user_id) values (${bob.id})`)
    expect(await as(alice.id, sql => sql`delete from instance_admins where user_id = ${bob.id} returning user_id`)).toHaveLength(0)

    // Bob demotes the admin, then cannot demote himself while he is the last one.
    // (Other admins in the dev database would make him not the last: count first.)
    await as(bob.id, sql => sql`delete from instance_admins where user_id = ${admin.id}`)
    const [{ n }] = await owner`select count(*)::int as n from instance_admins` as any
    if (n === 1) await rejectsWith(as(bob.id, sql => sql`delete from instance_admins where user_id = ${bob.id}`), 'KB002')
    await makeAdmin(admin)
  })
})

describe('remove_user', () => {
  it('only admins remove, and not themselves', async () => {
    const victim = await createUser('victim')
    await rejectsWith(as(alice.id, sql => sql`select app.remove_user(${victim.id})`), '42501')
    await rejectsWith(as(admin.id, sql => sql`select app.remove_user(${admin.id})`), '42501')
    await rejectsWith(as(admin.id, sql => sql`select app.remove_user(${randomUUID()})`), 'P0002')
  })

  it('hands over sole-owned boards and teams, deletes empty ones, keeps cards', async () => {
    const leaver = await createUser('leaver')
    const editor = await createUser('editor')
    const viewer = await createUser('viewer')
    const ids = await as(leaver.id, async (sql) => {
      const [{ id: shared }] = await sql`select id from app.create_board('Shared', null)` as any
      const [{ id: alone }] = await sql`select id from app.create_board('Alone', null)` as any
      const [{ id: team }] = await sql`select id from app.create_team('Team')` as any
      const [{ id: teamBoard }] = await sql`select id from app.create_board('Team board', ${team})` as any
      const [{ id: soloTeam }] = await sql`select id from app.create_team('Solo team')` as any
      await sql`select app.add_board_member(${shared}, ${viewer.email}, 'viewer')`
      await sql`select app.add_board_member(${shared}, ${editor.email}, 'editor')`
      await sql`select app.add_team_member(${team}, ${viewer.email}, 'viewer')`
      const [{ id: col }] = await sql`insert into columns (board_id, title, position) values (${shared}, 'Todo', 1) returning id` as any
      const [{ id: card }] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${shared}, ${col}, 'Keep me', 1, ${leaver.id}) returning id` as any
      await sql`insert into card_assignees (card_id, board_id, user_id) values (${card}, ${shared}, ${leaver.id})`
      return { shared, alone, team, teamBoard, soloTeam, card }
    })

    await as(admin.id, sql => sql`select app.remove_user(${leaver.id})`)

    const [state] = await owner`select
      (select role from board_members where board_id = ${ids.shared} and user_id = ${editor.id}) as shared_editor,
      (select count(*)::int from boards where id = ${ids.alone}) as alone,
      (select role from team_members where team_id = ${ids.team} and user_id = ${viewer.id}) as team_viewer,
      (select owner_id from boards where id = ${ids.teamBoard}) as team_board_owner,
      (select count(*)::int from teams where id = ${ids.soloTeam}) as solo_team,
      (select created_by from cards where id = ${ids.card}) as card_creator,
      (select count(*)::int from users where id = ${leaver.id}) as user` as any
    expect(state).toEqual({
      shared_editor: 'owner', alone: 0, team_viewer: 'owner', team_board_owner: null,
      solo_team: 0, card_creator: null, user: 0,
    })
    // The unassignment is logged with the name while the user still existed.
    const [log] = await owner`select data from card_activity where card_id = ${ids.card} and kind = 'unassigned'` as any
    expect(log.data.user).toBe('leaver')
  })
})
