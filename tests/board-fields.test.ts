// RLS, value validation, option clean-up, activity and copying for custom
// card fields. Same setup as rls.test.ts.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  return u as { id: string, email: string }
}

type User = { id: string, email: string }
let owner: User, editor: User, viewer: User, outsider: User
let boardId: string, otherBoardId: string, cardId: string, otherCardId: string
const boards: string[] = []

const options = [{ id: 's', label: 'Small', color: '#22c55e' }, { id: 'l', label: 'Large', color: '#ef4444' }]

const newField = (by: User, kind: string, name = `${kind} ${randomUUID().slice(0, 8)}`, opts: unknown = kind === 'select' ? options : [], board = boardId) =>
  as(by.id, async sql => (await sql`
    insert into board_fields (board_id, name, kind, options, position)
    values (${board}, ${name}, ${kind}, ${sql.json(opts as postgres.JSONValue)}, 1) returning id`)[0]!.id as string)

const setValue = (by: User, fieldId: string, value: unknown, card = cardId, board = boardId) =>
  as(by.id, sql => sql`
    insert into card_field_values (card_id, board_id, field_id, value)
    values (${card}, ${board}, ${fieldId}, ${sql.json(value as postgres.JSONValue)})
    on conflict (card_id, field_id) do update set value = excluded.value, updated_at = now()`)

const valueOf = async (fieldId: string, card = cardId) =>
  (await as(owner.id, sql => sql`select value from card_field_values where card_id = ${card} and field_id = ${fieldId}`))[0]?.value

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Fields board')` as any
    const [{ id: columnId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: cardId }] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'Card', 1, ${owner.id}) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
  await as(outsider.id, async (sql) => {
    ;[{ id: otherBoardId }] = await sql`select id from app.create_board('Other board')` as any
    const [{ id: columnId }] = await sql`insert into columns (board_id, title, position) values (${otherBoardId}, 'Todo', 1) returning id` as any
    ;[{ id: otherCardId }] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${otherBoardId}, ${columnId}, 'Card', 1, ${outsider.id}) returning id` as any
  })
})

afterAll(async () => {
  await as(owner.id, sql => sql`delete from boards where id in ${sql([boardId, ...boards])}`)
  await as(outsider.id, sql => sql`delete from boards where id = ${otherBoardId}`)
  await Promise.all([app.end(), auth.end()])
})

describe('board fields', () => {
  it('editors define fields and set values; viewers read only', async () => {
    const field = await newField(editor, 'text')
    expect((await as(editor.id, sql => sql`update board_fields set show_on_card = true where id = ${field}`)).count).toBe(1)
    await setValue(editor, field, 'hello')
    await as(viewer.id, async (sql) => {
      expect(await sql`select id from board_fields where id = ${field}`).toHaveLength(1)
      expect(await sql`select value from card_field_values where field_id = ${field}`).toEqual([{ value: 'hello' }])
      expect((await sql`update board_fields set name = 'x' where id = ${field}`).count).toBe(0)
      expect((await sql`update card_field_values set value = '"x"' where field_id = ${field}`).count).toBe(0)
      expect((await sql`delete from card_field_values where field_id = ${field}`).count).toBe(0)
      expect((await sql`delete from board_fields where id = ${field}`).count).toBe(0)
    })
    await rejectsWith(newField(viewer, 'text'), '42501')
    await rejectsWith(setValue(viewer, field, 'nope'), '42501')
  })

  it('outsiders see nothing; fields and values stay on their board', async () => {
    const field = await newField(owner, 'number')
    await setValue(owner, field, 3)
    await as(outsider.id, async (sql) => {
      expect(await sql`select id from board_fields where board_id = ${boardId}`).toHaveLength(0)
      expect(await sql`select value from card_field_values where board_id = ${boardId}`).toHaveLength(0)
    })
    await rejectsWith(newField(outsider, 'text', 'x', [], boardId), '42501')
    // Another board's field on this card: composite FK.
    const foreign = await newField(outsider, 'text', 'Foreign', [], otherBoardId)
    await rejectsWith(setValue(owner, foreign, 'x'), '23503')
    await rejectsWith(setValue(outsider, foreign, 'x', otherCardId, boardId), '42501')
    // kind and board_id cannot change.
    await rejectsWith(as(owner.id, sql => sql`update board_fields set kind = 'text' where id = ${field}`), '42501')
    await rejectsWith(as(owner.id, sql => sql`update board_fields set board_id = ${otherBoardId} where id = ${field}`), '42501')
  })

  it('names are unique per board regardless of case', async () => {
    await newField(owner, 'text', 'Customer')
    await rejectsWith(newField(owner, 'number', 'customer'), '23505')
    await rejectsWith(newField(owner, 'text', ''), '23514')
  })

  it('checks options: select only, well formed, unique ids', async () => {
    await rejectsWith(newField(owner, 'text', 'With options', options), 'KB006')
    await rejectsWith(newField(owner, 'select', 'Bad colour', [{ id: 'a', label: 'A', color: 'red' }]), 'KB006')
    await rejectsWith(newField(owner, 'select', 'Dup ids', [{ id: 'a', label: 'A', color: '#000000' }, { id: 'a', label: 'B', color: '#000000' }]), 'KB006')
    await rejectsWith(newField(owner, 'select', 'No label', [{ id: 'a', color: '#000000' }]), 'KB006')
    await rejectsWith(newField(owner, 'select', 'Not array', {}), 'KB006')
    await newField(owner, 'select', 'No options yet', [])
  })

  it('checks values against the field kind', async () => {
    const cases: [string, unknown[], unknown[]][] = [
      ['text', ['x'], ['', 5, true, 'x'.repeat(2001)]],
      ['number', [0, -1.5, 42], ['1', true]],
      ['date', ['2026-02-28'], ['2026-02-30', '28/02/2026', 20260228]],
      ['select', ['s', 'l'], ['m', 1, 'Small']],
      ['checkbox', [true, false], ['true', 1]],
      ['url', ['https://example.com/a?b=c', 'http://x.y'], ['ftp://example.com', 'javascript:alert(1)', 'https://', 'https://a b']],
    ]
    for (const [kind, good, bad] of cases) {
      const field = await newField(owner, kind)
      for (const v of good) {
        await setValue(owner, field, v)
        expect(await valueOf(field)).toEqual(v)
      }
      for (const v of bad) await rejectsWith(setValue(owner, field, v), 'KB005')
    }
  })

  it('removing a select option clears the values that used it', async () => {
    const field = await newField(owner, 'select')
    await setValue(owner, field, 'l')
    await as(owner.id, sql => sql`update board_fields set options = ${sql.json([options[1]] as postgres.JSONValue)} where id = ${field}`)
    expect(await valueOf(field)).toBe('l')
    await as(owner.id, sql => sql`update board_fields set options = ${sql.json([options[0]] as postgres.JSONValue)} where id = ${field}`)
    expect(await valueOf(field)).toBeUndefined()
  })

  it('logs value changes with display text; not when the field goes', async () => {
    const field = await newField(editor, 'select', 'Size')
    await setValue(editor, field, 's')
    await setValue(editor, field, 'l')
    await setValue(editor, field, 'l')
    await as(editor.id, sql => sql`delete from card_field_values where field_id = ${field}`)
    await setValue(editor, field, 's')
    await as(editor.id, sql => sql`delete from board_fields where id = ${field}`)
    const rows = await as(owner.id, sql => sql`
      select actor_id, data from card_activity where card_id = ${cardId} and kind = 'field' and data ->> 'field' = 'Size'
      order by created_at`)
    expect(rows.map(r => r.data)).toEqual([
      { field: 'Size', kind: 'select', from: null, to: 'Small' },
      { field: 'Size', kind: 'select', from: 'Small', to: 'Large' },
      { field: 'Size', kind: 'select', from: 'Large', to: null },
      { field: 'Size', kind: 'select', from: null, to: 'Small' },
    ])
    expect(rows.every(r => r.actor_id === editor.id)).toBe(true)
  })

  it('app.copy_board copies fields always and values with cards', async () => {
    const src = await as(owner.id, async sql => (await sql`select id from app.create_board('Copy source')`)[0]!.id as string)
    boards.push(src)
    const card = await as(owner.id, async (sql) => {
      const [{ id: col }] = await sql`insert into columns (board_id, title, position) values (${src}, 'Todo', 1) returning id` as any
      return (await sql`insert into cards (board_id, column_id, title, position, created_by) values (${src}, ${col}, 'Card', 1, ${owner.id}) returning id`)[0]!.id as string
    })
    const field = await newField(owner, 'select', 'Size', options, src)
    await setValue(owner, field, 'l', card, src)

    const [full, empty] = await as(owner.id, async sql => [
      (await sql`select id from app.copy_board(${src}, 'Copy', null, true)`)[0]!.id as string,
      (await sql`select id from app.copy_board(${src}, 'Copy', null, false)`)[0]!.id as string,
    ])
    boards.push(full, empty)
    await as(owner.id, async (sql) => {
      const fields = await sql`select id, name, kind, options from board_fields where board_id in ${sql([full, empty])}`
      expect(fields).toHaveLength(2)
      for (const f of fields) expect(f).toMatchObject({ name: 'Size', kind: 'select', options })
      expect(fields.some(f => f.id === field)).toBe(false)
      const values = await sql`select v.value, f.board_id from card_field_values v join board_fields f on f.id = v.field_id where v.board_id in ${sql([full, empty])}`
      expect(values).toEqual([{ value: 'l', board_id: full }])
    })
  })
})
