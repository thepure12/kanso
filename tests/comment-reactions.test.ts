// RLS for comment reactions: everyone on the board reacts for themselves only,
// nothing while the board is archived, same-board FK, known emoji only.
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

async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  return u as { id: string, email: string }
}

type User = { id: string, email: string }
let owner: User, viewer: User, outsider: User
let boardId: string, otherBoardId: string, commentId: string

const react = (by: User, emoji = '👍', board = boardId, comment = commentId) =>
  as(by.id, sql => sql`insert into comment_reactions (comment_id, board_id, user_id, emoji) values (${comment}, ${board}, ${by.id}, ${emoji})`)

const reactions = (by: User = owner) =>
  as(by.id, async sql => (await sql`select user_id, emoji from comment_reactions where comment_id = ${commentId} order by created_at`)
    .map(r => `${r.user_id === owner.id ? 'owner' : r.user_id === viewer.id ? 'viewer' : 'other'} ${r.emoji}`))

beforeAll(async () => {
  ;[owner, viewer, outsider] = await Promise.all(['owner', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Reactions board')` as any
    const [{ id: col }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id`
    const [{ id: card }] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${col}, 'Card', 1, ${owner.id}) returning id`
    ;[{ id: commentId }] = await sql`insert into card_comments (card_id, board_id, author_id, body) values (${card}, ${boardId}, ${owner.id}, 'Hi') returning id` as any
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
    ;[{ id: otherBoardId }] = await sql`select id from app.create_board('Other board')` as any
  })
})

afterAll(async () => {
  for (const b of [boardId, otherBoardId]) await as(owner.id, sql => sql`delete from boards where id = ${b}`)
  await Promise.all([app.end(), auth.end()])
})

describe('comment_reactions', () => {
  it('viewers react for themselves only; outsiders neither react nor read', async () => {
    await react(owner)
    await react(viewer)
    await react(viewer, '🎉')
    await expect(as(viewer.id, sql => sql`insert into comment_reactions (comment_id, board_id, user_id, emoji) values (${commentId}, ${boardId}, ${owner.id}, '🚀')`)).rejects.toMatchObject({ code: '42501' })
    await expect(react(outsider)).rejects.toMatchObject({ code: '42501' })
    expect(await reactions(outsider)).toEqual([])
    expect(await reactions(viewer)).toEqual(['owner 👍', 'viewer 👍', 'viewer 🎉'])
  })

  it('the same emoji once per person, known emoji only', async () => {
    await expect(react(viewer)).rejects.toMatchObject({ code: '23505' })
    await expect(react(viewer, '🦄')).rejects.toMatchObject({ code: '23514' })
  })

  it('cannot point at a comment of another board', async () => {
    await as(owner.id, sql => sql`select app.add_board_member(${otherBoardId}, ${viewer.email}, 'viewer')`)
    await expect(react(viewer, '👀', otherBoardId)).rejects.toMatchObject({ code: '23503' })
  })

  it('people remove only their own reactions', async () => {
    expect((await as(viewer.id, sql => sql`delete from comment_reactions where comment_id = ${commentId}`)).count).toBe(2)
    expect(await reactions()).toEqual(['owner 👍'])
  })

  it('nothing changes while the board is archived', async () => {
    await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    await expect(react(viewer)).rejects.toMatchObject({ code: '42501' })
    expect((await as(owner.id, sql => sql`delete from comment_reactions where comment_id = ${commentId}`)).count).toBe(0)
    await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
  })

  it('go with the comment', async () => {
    await as(owner.id, sql => sql`delete from card_comments where id = ${commentId}`)
    expect(await reactions()).toEqual([])
  })
})
