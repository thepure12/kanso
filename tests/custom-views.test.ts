// RLS for custom views (0137_custom_views_rls.sql): personal views of columns
// from any boards; only visible columns go in, and reads skip lost ones.
// Their look (0144_custom_view_appearance_rls.sql): background, accent, outline
// and the uploaded image, all personal. Stars (0148_custom_view_stars_rls.sql):
// only their user stars a view.
import { randomUUID } from 'node:crypto'
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
const created: string[] = []
async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  created.push(u!.id)
  return u as User
}

let alice: User, bob: User, outsider: User
let boardA: string, boardB: string
let colA1: string, colA2: string, colB1: string

const newView = (by: User, name = `View ${randomUUID().slice(0, 8)}`) =>
  as(by.id, async sql => (await sql`insert into custom_views (user_id, name) values (${by.id}, ${name}) returning id`)[0]!.id as string)

const addColumn = (by: User, viewId: string, columnId: string, boardId: string, position = 0) =>
  as(by.id, sql => sql`insert into custom_view_columns (view_id, column_id, board_id, position) values (${viewId}, ${columnId}, ${boardId}, ${position})`)

/** The view's columns the user can read, joined to columns under RLS like loadCustomView. */
const shownColumns = (by: User, viewId: string) =>
  as(by.id, async sql => (await sql`
    select vc.column_id from custom_view_columns vc join columns c on c.id = vc.column_id
    where vc.view_id = ${viewId} order by vc.position`).map(r => r.column_id as string))

beforeAll(async () => {
  ;[alice, bob, outsider] = await Promise.all(['alice', 'bob', 'outsider'].map(createUser)) as User[]
  await as(alice.id, async (sql) => {
    ;[{ id: boardA }] = await sql`select id from app.create_board('Custom views A')` as any
    ;[{ id: colA1 }] = await sql`insert into columns (board_id, title, position) values (${boardA}, 'A1', 1) returning id` as any
    ;[{ id: colA2 }] = await sql`insert into columns (board_id, title, position) values (${boardA}, 'A2', 2) returning id` as any
    await sql`select app.add_board_member(${boardA}, ${bob.email}, 'viewer')`
  })
  await as(bob.id, async (sql) => {
    ;[{ id: boardB }] = await sql`select id from app.create_board('Custom views B')` as any
    ;[{ id: colB1 }] = await sql`insert into columns (board_id, title, position) values (${boardB}, 'B1', 1) returning id` as any
  })
})

afterAll(async () => {
  await owner_`delete from boards where id in ${owner_([boardA, boardB])}`
  await owner_`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner_.end()])
})

describe('custom views', () => {
  it('are personal: nobody else reads, renames or deletes them', async () => {
    const id = await newView(alice)
    await addColumn(alice, id, colA1, boardA)
    for (const u of [bob, outsider]) {
      expect(await as(u.id, sql => sql`select 1 from custom_views where id = ${id}`)).toHaveLength(0)
      expect(await as(u.id, sql => sql`select 1 from custom_view_columns where view_id = ${id}`)).toHaveLength(0)
      expect((await as(u.id, sql => sql`update custom_views set name = 'x' where id = ${id}`)).count).toBe(0)
      expect((await as(u.id, sql => sql`delete from custom_view_columns where view_id = ${id}`)).count).toBe(0)
      expect((await as(u.id, sql => sql`delete from custom_views where id = ${id}`)).count).toBe(0)
      // Nor add columns to it.
      await rejectsWith(addColumn(u, id, colB1, boardB), '42501')
    }
    // Nobody creates a view for someone else.
    await rejectsWith(as(bob.id, sql => sql`insert into custom_views (user_id, name) values (${alice.id}, 'Not mine')`), '42501')
    expect(await shownColumns(alice, id)).toEqual([colA1])
    expect((await as(alice.id, sql => sql`delete from custom_views where id = ${id}`)).count).toBe(1)
  })

  it('take only columns the user can see, from several boards', async () => {
    const id = await newView(bob)
    await addColumn(bob, id, colB1, boardB, 0)
    await addColumn(bob, id, colA2, boardA, 1) // a viewer of board A
    expect(await shownColumns(bob, id)).toEqual([colB1, colA2])
    const mine = await newView(alice)
    await rejectsWith(addColumn(alice, mine, colB1, boardB), '42501')
    // The board id must be the column's own (composite FK).
    await expect(addColumn(bob, id, colA1, boardB)).rejects.toMatchObject({ code: expect.stringMatching(/42501|23503/) })
  })

  it('skip columns the user lost access to and drop deleted columns', async () => {
    const id = await newView(bob)
    await addColumn(bob, id, colA1, boardA, 0)
    await addColumn(bob, id, colB1, boardB, 1)
    await as(alice.id, sql => sql`delete from board_members where board_id = ${boardA} and user_id = ${bob.id}`)
    expect(await shownColumns(bob, id)).toEqual([colB1])
    // Back on the board, the column shows again.
    await as(alice.id, sql => sql`select app.add_board_member(${boardA}, ${bob.email}, 'viewer')`)
    expect(await shownColumns(bob, id)).toEqual([colA1, colB1])
    // A limited member sees only the columns they have access to.
    await owner_`insert into board_member_limits (board_id, user_id) values (${boardA}, ${bob.id})`
    expect(await shownColumns(bob, id)).toEqual([colB1])
    await rejectsWith(addColumn(bob, id, colA2, boardA, 2), '42501')
    await owner_`delete from board_member_limits where board_id = ${boardA} and user_id = ${bob.id}`
    await as(bob.id, sql => sql`delete from columns where id = ${colB1}`)
    expect(await owner_`select 1 from custom_view_columns where view_id = ${id} and column_id = ${colB1}`).toHaveLength(0)
  })

  it('names are unique per user, case-insensitively', async () => {
    const name = `Same ${randomUUID().slice(0, 8)}`
    await newView(alice, name)
    await rejectsWith(newView(alice, name.toUpperCase()), '23505')
    await newView(bob, name)
  })

  it('look: only their user sets it and reads the uploaded image', async () => {
    const id = await newView(alice)
    const outline = { color: 'accent', width: 2, glow: 1 }
    await as(alice.id, sql => sql`update custom_views set accent = 'rose', column_outline = ${sql.json(outline)},
      background = ${sql.json({ kind: 'gradient', value: 'ocean', logo: true })} where id = ${id}`)
    expect(await as(alice.id, sql => sql`select accent, column_outline, background from custom_views where id = ${id}`))
      .toEqual([{ accent: 'rose', column_outline: outline, background: { kind: 'gradient', value: 'ocean', logo: true } }])
    expect((await as(bob.id, sql => sql`update custom_views set accent = 'blue' where id = ${id}`)).count).toBe(0)

    // Shape checks as on boards.
    await rejectsWith(as(alice.id, sql => sql`update custom_views set accent = 'mauve' where id = ${id}`), '23514')
    await rejectsWith(as(alice.id, sql => sql`update custom_views set column_outline = ${sql.json({ color: 'accent', width: 9, glow: 0 })} where id = ${id}`), '23514')
    await rejectsWith(as(alice.id, sql => sql`update custom_views set background = ${sql.json({ kind: 'color', value: 'red' })} where id = ${id}`), '23514')

    // An upload background needs its image; only the view's user writes or reads it.
    await rejectsWith(as(alice.id, sql => sql`update custom_views set background = ${sql.json({ kind: 'upload', value: 'abc' })} where id = ${id}`), 'KB009')
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    await rejectsWith(as(bob.id, sql => sql`insert into custom_view_backgrounds (view_id, content_type, size, data) values (${id}, 'image/png', ${png.length}, ${png})`), '42501')
    await as(alice.id, async (sql) => {
      await sql`insert into custom_view_backgrounds (view_id, content_type, size, data) values (${id}, 'image/png', ${png.length}, ${png})`
      await sql`update custom_views set background = ${sql.json({ kind: 'upload', value: 'abc' })} where id = ${id}`
    })
    expect(await as(alice.id, sql => sql`select 1 from custom_view_backgrounds where view_id = ${id}`)).toHaveLength(1)
    expect(await as(bob.id, sql => sql`select 1 from custom_view_backgrounds where view_id = ${id}`)).toHaveLength(0)
    expect((await as(bob.id, sql => sql`delete from custom_view_backgrounds where view_id = ${id}`)).count).toBe(0)

    // Another background drops the image.
    await as(alice.id, sql => sql`update custom_views set background = null where id = ${id}`)
    expect(await owner_`select 1 from custom_view_backgrounds where view_id = ${id}`).toHaveLength(0)
  })

  it('stars: only their user stars or unstars a view', async () => {
    const id = await newView(alice)
    expect((await as(bob.id, sql => sql`update custom_views set starred_at = now() where id = ${id}`)).count).toBe(0)
    expect((await as(alice.id, sql => sql`update custom_views set starred_at = now() where id = ${id}`)).count).toBe(1)
    expect((await owner_`select starred_at from custom_views where id = ${id}`)[0]!.starred_at).not.toBeNull()
    expect((await as(alice.id, sql => sql`update custom_views set starred_at = null where id = ${id}`)).count).toBe(1)
    // Still only the granted columns.
    await rejectsWith(as(alice.id, sql => sql`update custom_views set user_id = ${bob.id} where id = ${id}`), '42501')
  })
})
