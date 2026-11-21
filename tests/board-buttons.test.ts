// RLS for board buttons: personal rows (own user only) and shared rows (editors manage), copy_board.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const owner_ = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>, tokenBoards?: string[]) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    if (tokenBoards) await sql`select set_config('app.token_boards', ${`{${tokenBoards.join(',')}}`}, true)`
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

let owner: User, editor: User, viewer: User, outsider: User
let boardId: string

const steps = [{ kind: 'archive' }]

/** Inserts a button as `by`: personal unless shared. */
const newButton = (by: User, opts: { shared?: boolean, name?: string, scope?: string, steps?: unknown } = {}) =>
  as(by.id, async sql => (await sql`
    insert into board_buttons (board_id, user_id, created_by, scope, name, steps)
    values (${boardId}, ${opts.shared ? null : by.id}, ${by.id}, ${opts.scope ?? 'card'}, ${opts.name ?? `Button ${randomUUID().slice(0, 8)}`}, ${sql.json((opts.steps ?? steps) as any)})
    returning id`)[0]!.id as string)

const visible = (by: User, id: string) =>
  as(by.id, async sql => (await sql`select 1 from board_buttons where id = ${id}`).length === 1)

const rename = (by: User, id: string) =>
  as(by.id, async sql => (await sql`update board_buttons set name = ${`Renamed ${randomUUID().slice(0, 8)}`} where id = ${id}`).count)

const remove = (by: User, id: string) =>
  as(by.id, async sql => (await sql`delete from board_buttons where id = ${id}`).count)

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Buttons board')` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
})

const boards: string[] = []
afterAll(async () => {
  await owner_`delete from boards where id in ${owner_([boardId, ...boards])}`
  await owner_`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner_.end()])
})

describe('board buttons', () => {
  it('personal buttons: everyone with access can make their own, nobody else sees them', async () => {
    for (const u of [owner, editor, viewer]) {
      const id = await newButton(u)
      expect(await visible(u, id)).toBe(true)
      for (const other of [owner, editor, viewer, outsider].filter(x => x !== u)) {
        expect(await visible(other, id)).toBe(false)
        expect(await rename(other, id)).toBe(0)
        expect(await remove(other, id)).toBe(0)
      }
      expect(await rename(u, id)).toBe(1)
      expect(await remove(u, id)).toBe(1)
    }
    await rejectsWith(newButton(outsider), '42501')
  })

  it('cannot make a button for someone else', async () => {
    await rejectsWith(as(editor.id, sql => sql`
      insert into board_buttons (board_id, user_id, created_by, scope, name, steps)
      values (${boardId}, ${viewer.id}, ${editor.id}, 'card', 'Theirs', ${sql.json(steps)})`), '42501')
  })

  it('shared buttons: everyone on the board reads them, editors manage them', async () => {
    const id = await newButton(editor, { shared: true })
    for (const u of [owner, editor, viewer]) expect(await visible(u, id)).toBe(true)
    expect(await visible(outsider, id)).toBe(false)
    await rejectsWith(newButton(viewer, { shared: true }), '42501')
    expect(await rename(viewer, id)).toBe(0)
    expect(await remove(viewer, id)).toBe(0)
    expect(await rename(owner, id)).toBe(1)
    expect(await remove(owner, id)).toBe(1)
  })

  it('scope and owner are fixed', async () => {
    const id = await newButton(editor)
    await rejectsWith(as(editor.id, sql => sql`update board_buttons set user_id = null where id = ${id}`), '42501')
    await rejectsWith(as(editor.id, sql => sql`update board_buttons set scope = 'board' where id = ${id}`), '42501')
  })

  it('names are unique per user, scope and among shared buttons, case-insensitively', async () => {
    const name = `Mine ${randomUUID().slice(0, 8)}`
    await newButton(editor, { name })
    await rejectsWith(newButton(editor, { name: name.toUpperCase() }), '23505')
    await newButton(editor, { name, scope: 'board', steps: [{ kind: 'archiveColumn', columnId: randomUUID() }] })
    await newButton(viewer, { name })
    await newButton(editor, { name, shared: true })
    await rejectsWith(newButton(owner, { name: name.toLowerCase(), shared: true }), '23505')
  })

  it('checks scope and the steps list', async () => {
    await rejectsWith(newButton(owner, { scope: 'column' }), '23514')
    await rejectsWith(newButton(owner, { steps: [] }), '23514')
    await rejectsWith(newButton(owner, { steps: { kind: 'archive' } }), '23514')
    await rejectsWith(newButton(owner, { steps: Array.from({ length: 11 }, () => ({ kind: 'archive' })) }), '23514')
  })

  it('archived boards block shared buttons but keep personal ones', async () => {
    const shared = await newButton(owner, { shared: true })
    await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    try {
      await rejectsWith(newButton(editor, { shared: true }), '42501')
      expect(await rename(owner, shared)).toBe(0)
      const mine = await newButton(viewer)
      expect(await rename(viewer, mine)).toBe(1)
    }
    finally {
      await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
    }
  })

  it('copy_board copies shared buttons with their column and tag ids remapped', async () => {
    const [col] = await as(owner.id, sql => sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 99999) returning id`)
    const [tag] = await as(owner.id, sql => sql`insert into tags (board_id, name, color) values (${boardId}, ${`t-${randomUUID().slice(0, 6)}`}, '#ff0000') returning id`)
    const name = `Copied ${randomUUID().slice(0, 8)}`
    await newButton(owner, { shared: true, name, steps: [{ kind: 'move', columnId: col!.id }, { kind: 'addTag', tagId: tag!.id }, { kind: 'assign', userId: editor.id }] })
    await newButton(owner, { name: `${name} mine` })
    const copy = await as(owner.id, async (sql) => {
      const [b] = await sql`select (app.copy_board(${boardId}, 'Copy', null, false)).id`
      return b!.id as string
    })
    boards.push(copy)
    const rows = await owner_`select name, user_id, steps from board_buttons where board_id = ${copy} and name like ${`${name}%`}`
    expect(rows).toHaveLength(1)
    expect(rows[0]!.user_id).toBeNull()
    const [newCol] = await owner_`select id from columns where board_id = ${copy} and title = 'Done'`
    const [newTag] = await owner_`select t.id from tags t join tags o on o.name = t.name where t.board_id = ${copy} and o.id = ${tag!.id}`
    expect(rows[0]!.steps).toEqual([{ kind: 'move', columnId: newCol!.id }, { kind: 'addTag', tagId: newTag!.id }, { kind: 'assign', userId: editor.id }])
  })
})
