// RLS tests for tags. Same setup as rls.test.ts.
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

let owner: { id: string, email: string }
let editor: { id: string, email: string }
let viewer: { id: string, email: string }
let outsider: { id: string, email: string }
let boardId: string
let cardId: string
let tagId: string
let otherBoardId: string
let otherTagId: string

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser))
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Tag board')` as any
    const [{ id: columnId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: cardId }] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, 'Card', 1, ${owner.id}) returning id` as any
    ;[{ id: tagId }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'bug', '#ef4444') returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
  await as(outsider.id, async (sql) => {
    ;[{ id: otherBoardId }] = await sql`select id from app.create_board('Other board')` as any
    ;[{ id: otherTagId }] = await sql`insert into tags (board_id, name, color) values (${otherBoardId}, 'other', '#22c55e') returning id` as any
  })
})

afterAll(async () => {
  await as(owner.id, sql => sql`delete from boards where id = ${boardId}`)
  await as(outsider.id, sql => sql`delete from boards where id = ${otherBoardId}`)
  await Promise.all([app.end(), auth.end()])
})

describe('tags', () => {
  it('editor can create, recolour and apply tags', async () => {
    await as(editor.id, async (sql) => {
      const [t] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'feature', '#3b82f6') returning id`
      expect((await sql`update tags set color = '#8b5cf6' where id = ${t!.id}`).count).toBe(1)
      await sql`insert into card_tags (card_id, tag_id, board_id) values (${cardId}, ${tagId}, ${boardId})`
      await sql`delete from tags where id = ${t!.id}`
    })
    expect(await as(viewer.id, sql => sql`select tag_id from card_tags where card_id = ${cardId}`)).toEqual([{ tag_id: tagId }])
  })

  it('viewer can read but not create, change or apply tags', async () => {
    await as(viewer.id, async (sql) => {
      expect(await sql`select id from tags where board_id = ${boardId}`).toHaveLength(1)
      expect((await sql`update tags set name = 'x' where id = ${tagId}`).count).toBe(0)
      expect((await sql`delete from tags where id = ${tagId}`).count).toBe(0)
      expect((await sql`delete from card_tags where card_id = ${cardId}`).count).toBe(0)
    })
    await rejectsWith(as(viewer.id, sql => sql`insert into tags (board_id, name, color) values (${boardId}, 'x', '#000000')`), '42501')
    await rejectsWith(as(viewer.id, sql => sql`insert into card_tags (card_id, tag_id, board_id) values (${cardId}, ${tagId}, ${boardId}) on conflict do nothing`), '42501')
  })

  it('non-member sees nothing', async () => {
    await as(outsider.id, async (sql) => {
      expect(await sql`select id from tags where board_id = ${boardId}`).toHaveLength(0)
      expect(await sql`select tag_id from card_tags where board_id = ${boardId}`).toHaveLength(0)
      expect((await sql`update tags set name = 'x' where id = ${tagId}`).count).toBe(0)
    })
    await rejectsWith(as(outsider.id, sql => sql`insert into tags (board_id, name, color) values (${boardId}, 'x', '#000000')`), '42501')
  })

  it('cards cannot carry another board\'s tag', async () => {
    // Claiming the card's board: FK on (tag_id, board_id) fails.
    await rejectsWith(as(owner.id, sql => sql`insert into card_tags (card_id, tag_id, board_id) values (${cardId}, ${otherTagId}, ${boardId})`), '23503')
    // Claiming the tag's board: the policy fails first.
    await rejectsWith(as(owner.id, sql => sql`insert into card_tags (card_id, tag_id, board_id) values (${cardId}, ${otherTagId}, ${otherBoardId})`), '42501')
  })

  it('tag cannot move to another board', async () => {
    await rejectsWith(as(owner.id, sql => sql`update tags set board_id = ${otherBoardId} where id = ${tagId}`), '42501')
  })

  it('colour must be lowercase #rrggbb and names unique per board', async () => {
    await rejectsWith(as(owner.id, sql => sql`insert into tags (board_id, name, color) values (${boardId}, 'x', 'red')`), '23514')
    await rejectsWith(as(owner.id, sql => sql`insert into tags (board_id, name, color) values (${boardId}, 'x', '#ABCDEF')`), '23514')
    await rejectsWith(as(owner.id, sql => sql`insert into tags (board_id, name, color) values (${boardId}, 'bug', '#000000')`), '23505')
  })

  it('deleting a tag removes it from cards', async () => {
    await as(owner.id, sql => sql`delete from tags where id = ${tagId}`)
    expect(await as(owner.id, sql => sql`select tag_id from card_tags where card_id = ${cardId}`)).toHaveLength(0)
  })
})
