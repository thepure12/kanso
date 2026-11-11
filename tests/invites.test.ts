// RLS tests for invites. Same setup as rls.test.ts.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { allowExternalInvites } from './helpers/settings'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const ownerDb = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

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

async function createUser(name: string, email = newEmail(name), verified = true) {
  const [u] = await auth`insert into users (email, name, email_verified_at) values (${email}, ${name}, ${verified ? new Date() : null}) returning id, email`
  return u as { id: string, email: string }
}

let owner: { id: string, email: string }
let editor: { id: string, email: string }
let outsider: { id: string, email: string }
let boardId: string
let teamId: string
let restoreSettings: () => Promise<void>

beforeAll(async () => {
  // The tests invite outside emails; a dev database may have that turned off.
  restoreSettings = await allowExternalInvites(ownerDb)
  ;[owner, editor, outsider] = await Promise.all(['owner', 'editor', 'outsider'].map(n => createUser(n)))
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Invites', null)` as any
    ;[{ id: teamId }] = await sql`select id from app.create_team('Invites team')` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
  })
})

afterAll(async () => {
  await as(owner.id, async (sql) => {
    await sql`delete from boards where id = ${boardId}`
    await sql`delete from teams where id = ${teamId}`
  })
  await restoreSettings?.()
  await Promise.all([app.end(), auth.end(), ownerDb.end()])
})

describe('invites', () => {
  it('adding an unknown email records an invite', async () => {
    const email = newEmail('new')
    const [row] = await as(owner.id, sql => sql`select app.add_board_member(${boardId}, ${email}, 'viewer') as user_id`)
    expect(row!.user_id).toBeNull()
    // Re-adding updates the role instead of duplicating.
    await as(owner.id, sql => sql`select app.add_board_member(${boardId}, ${email.toUpperCase()}, 'editor')`)
    const rows = await as(editor.id, sql => sql`select email, role from invites where board_id = ${boardId} and email = ${email}`)
    expect(rows).toEqual([{ email, role: 'editor' }])
  })

  it('only owners invite and revoke; outsiders see nothing', async () => {
    const email = newEmail('x')
    await rejectsWith(as(editor.id, sql => sql`select app.add_board_member(${boardId}, ${email}, 'viewer')`), '42501')
    await as(owner.id, sql => sql`select app.add_board_member(${boardId}, ${email}, 'viewer')`)
    expect(await as(outsider.id, sql => sql`select id from invites where email = ${email}`)).toHaveLength(0)
    expect(await as(editor.id, sql => sql`delete from invites where email = ${email} returning id`)).toHaveLength(0)
    await rejectsWith(as(owner.id, sql => sql`insert into invites (email, board_id, role) values ('y@test.local', ${boardId}, 'owner')`), '42501')
    expect(await as(owner.id, sql => sql`delete from invites where email = ${email} returning id`)).toHaveLength(1)
  })

  it('kanban_auth checks invites only through app.has_invite', async () => {
    const email = newEmail('gate')
    const has = async (e: string) => (await auth`select app.has_invite(${e}) as ok`)[0]!.ok
    expect(await has(email)).toBe(false)
    await as(owner.id, sql => sql`select app.add_team_member(${teamId}, ${email}, 'viewer')`)
    expect(await has(email.toUpperCase())).toBe(true)
    await rejectsWith(auth`select id from invites`, '42501')
    await rejectsWith(app`select app.has_invite(${email})`, '42501')
  })

  it('signing up claims board and team invites', async () => {
    const email = newEmail('joiner')
    await as(owner.id, async (sql) => {
      await sql`select app.add_board_member(${boardId}, ${email}, 'editor')`
      await sql`select app.add_team_member(${teamId}, ${email}, 'viewer')`
    })
    const joiner = await createUser('joiner', email)
    const roles = await as(joiner.id, async sql => ({
      board: (await sql`select app.board_role(${boardId}) as r`)[0]!.r,
      team: (await sql`select app.team_role(${teamId}) as r`)[0]!.r,
    }))
    expect(roles).toEqual({ board: 'editor', team: 'viewer' })
    expect(await as(owner.id, sql => sql`select id from invites where email = ${email}`)).toHaveLength(0)
  })

  it('an unverified sign-up claims invites only once its email is verified', async () => {
    const email = newEmail('pending')
    await as(owner.id, sql => sql`select app.add_board_member(${boardId}, ${email}, 'editor')`)
    const pending = await createUser('pending', email, false)
    const role = async () => (await as(pending.id, sql => sql`select app.board_role(${boardId}) as r`))[0]!.r
    expect(await role()).toBeNull()
    expect(await as(owner.id, sql => sql`select id from invites where email = ${email}`)).toHaveLength(1)

    await auth`update users set email_verified_at = now() where id = ${pending.id}`
    expect(await role()).toBe('editor')
    expect(await as(owner.id, sql => sql`select id from invites where email = ${email}`)).toHaveLength(0)
  })
})
