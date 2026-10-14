// RLS, auto-watch and notification fan-out for card watchers; RLS, same-board
// and cycle checks, activity and copying for card links. Same setup as rls.test.ts.
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
let boardId: string, otherBoardId: string
let todoId: string, doneId: string, otherColumnId: string
const boards: string[] = []

const newCard = (by: User = owner, board = boardId, column = todoId) =>
  as(by.id, async sql => (await sql`
    insert into cards (board_id, column_id, title, position, created_by)
    values (${board}, ${column}, 'Card', 1, ${by.id}) returning id`)[0]!.id as string)

const watchers = (cardId: string) =>
  as(owner.id, async sql => (await sql`select user_id from card_watchers where card_id = ${cardId}`).map(r => r.user_id as string))

const inbox = (userId: string, cardId: string) =>
  as(userId, async sql => (await sql`
    select a.kind from notifications n join card_activity a on a.id = n.activity_id
    where n.card_id = ${cardId} order by a.created_at, a.id`).map(r => r.kind as string))

const link = (by: User, from: string, to: string, kind = 'blocks', board = boardId) =>
  as(by.id, async sql => (await sql`
    insert into card_links (board_id, from_card_id, to_card_id, kind, created_by)
    values (${board}, ${from}, ${to}, ${kind}, ${by.id}) returning id`)[0]!.id as string)

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Watchers board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
    ;[{ id: otherBoardId }] = await sql`select id from app.create_board('Other board')` as any
    ;[{ id: otherColumnId }] = await sql`insert into columns (board_id, title, position) values (${otherBoardId}, 'Todo', 1) returning id` as any
  })
  boards.push(boardId, otherBoardId)
})

afterAll(async () => {
  for (const b of boards) await as(owner.id, sql => sql`delete from boards where id = ${b}`)
  await Promise.all([app.end(), auth.end()])
})

describe('card_watchers', () => {
  it('anyone with board access watches and unwatches only for themselves', async () => {
    const id = await newCard()
    await as(viewer.id, sql => sql`insert into card_watchers (card_id, board_id, user_id) values (${id}, ${boardId}, ${viewer.id})`)
    await rejectsWith(as(viewer.id, sql => sql`insert into card_watchers (card_id, board_id, user_id) values (${id}, ${boardId}, ${editor.id})`), '42501')
    await rejectsWith(as(outsider.id, sql => sql`insert into card_watchers (card_id, board_id, user_id) values (${id}, ${boardId}, ${outsider.id})`), '42501')
    expect(await as(outsider.id, sql => sql`select 1 from card_watchers where card_id = ${id}`)).toHaveLength(0)
    expect(await as(viewer.id, sql => sql`select 1 from card_watchers where card_id = ${id}`)).toHaveLength(2)
    // Owner's row is not the viewer's to delete.
    expect((await as(viewer.id, sql => sql`delete from card_watchers where card_id = ${id}`)).count).toBe(1)
    expect(await watchers(id)).toEqual([owner.id])
  })

  it('auto-watches the creator and commenters once', async () => {
    const id = await newCard(editor)
    await as(owner.id, async (sql) => {
      await sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${owner.id}, 'one')`
      await sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${owner.id}, 'two')`
    })
    expect((await watchers(id)).sort()).toEqual([editor.id, owner.id].sort())
  })

  it('watchers get what assignees get, once, never as the actor, only with access', async () => {
    const id = await newCard()
    await as(viewer.id, sql => sql`insert into card_watchers (card_id, board_id, user_id) values (${id}, ${boardId}, ${viewer.id})`)
    await as(editor.id, async (sql) => {
      await sql`insert into card_watchers (card_id, board_id, user_id) values (${id}, ${boardId}, ${editor.id})`
    })
    await as(owner.id, async (sql) => {
      // Editor is both watcher and assignee; viewer only watches.
      await sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${editor.id}, ${boardId})`
      await sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${owner.id}, 'hi')`
      await sql`update cards set column_id = ${doneId}, due_date = '2026-12-01', title = 'Renamed' where id = ${id}`
    })
    expect(await inbox(viewer.id, id)).toEqual(['commented', 'moved', 'due'])
    expect(await inbox(editor.id, id)).toEqual(['assigned', 'commented', 'moved', 'due'])
    // The owner auto-watches the card but made every change.
    expect(await inbox(owner.id, id)).toEqual([])

    await as(owner.id, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${viewer.id}`)
    await as(owner.id, sql => sql`update cards set archived_at = now() where id = ${id}`)
    await as(owner.id, sql => sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`)
    expect(await inbox(viewer.id, id)).toEqual(['commented', 'moved', 'due'])
    // The creator, as a watcher, hears about other people's changes.
    await as(editor.id, sql => sql`update cards set archived_at = null, column_id = ${todoId} where id = ${id}`)
    expect(await inbox(owner.id, id)).toEqual(['moved'])
  })

  it('a board copy watches nothing', async () => {
    await newCard()
    const copy = await as(owner.id, async sql => (await sql`select id from app.copy_board(${boardId}, 'Copy', null, true)`)[0]!.id as string)
    boards.push(copy)
    const [{ n }] = await as(owner.id, sql => sql`select count(*)::int as n from card_watchers where board_id = ${copy}`)
    expect(n).toBe(0)
  })
})

describe('card_links', () => {
  it('viewers read, editors add and remove, outsiders see nothing', async () => {
    const [a, b] = [await newCard(), await newCard()]
    await rejectsWith(link(viewer, a, b), '42501')
    await rejectsWith(as(editor.id, sql => sql`insert into card_links (board_id, from_card_id, to_card_id, kind, created_by) values (${boardId}, ${a}, ${b}, 'blocks', ${owner.id})`), '42501')
    const id = await link(editor, a, b)
    expect(await as(viewer.id, sql => sql`select 1 from card_links where id = ${id}`)).toHaveLength(1)
    expect(await as(outsider.id, sql => sql`select 1 from card_links where id = ${id}`)).toHaveLength(0)
    expect((await as(viewer.id, sql => sql`delete from card_links where id = ${id}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`delete from card_links where id = ${id}`)).count).toBe(1)
  })

  it('links only cards of the same board, never a card to itself or twice', async () => {
    const [a, b] = [await newCard(), await newCard()]
    const other = await newCard(owner, otherBoardId, otherColumnId)
    await rejectsWith(link(owner, a, other), '23503')
    await rejectsWith(link(owner, a, other, 'blocks', otherBoardId), '23503')
    await rejectsWith(link(owner, a, a), '23514')
    await link(owner, a, b, 'relates')
    await rejectsWith(link(owner, a, b, 'relates'), '23505')
    // relates is symmetric.
    await rejectsWith(link(owner, b, a, 'relates'), '23505')
    await link(owner, b, a, 'duplicates')
  })

  it('rejects blocking cycles, direct or through other cards', async () => {
    const [a, b, c] = [await newCard(), await newCard(), await newCard()]
    await link(owner, a, b)
    await link(owner, b, c)
    await rejectsWith(link(owner, b, a), 'KB004')
    await rejectsWith(link(owner, c, a), 'KB004')
    // Other kinds do not count, and a cycle within one statement is caught too.
    await link(owner, c, a, 'relates')
    const [d, e] = [await newCard(), await newCard()]
    await rejectsWith(as(owner.id, sql => sql`
      insert into card_links (board_id, from_card_id, to_card_id, kind, created_by)
      values (${boardId}, ${d}, ${e}, 'blocks', ${owner.id}), (${boardId}, ${e}, ${d}, 'blocks', ${owner.id})`), 'KB004')
  })

  it('logs linked and unlinked on both cards', async () => {
    const [a, b] = [await newCard(), await newCard()]
    const id = await link(editor, a, b)
    await as(editor.id, sql => sql`delete from card_links where id = ${id}`)
    const log = (card: string) => as(owner.id, async sql => (await sql`
      select kind, data from card_activity where card_id = ${card} and kind like '%linked' order by created_at`).map(r => [r.kind, r.data.direction, r.data.card_id]))
    expect(await log(a)).toEqual([['linked', 'out', b], ['unlinked', 'out', b]])
    expect(await log(b)).toEqual([['linked', 'in', a], ['unlinked', 'in', a]])
    // kanban_app cannot write the log itself.
    await rejectsWith(as(owner.id, sql => sql`select app.log_activity(${a}, ${boardId}, 'linked')`), '42501')
  })

  it('deleting a card drops its links', async () => {
    const [a, b] = [await newCard(), await newCard()]
    const id = await link(owner, a, b)
    await as(owner.id, sql => sql`delete from cards where id = ${a}`)
    expect(await as(owner.id, sql => sql`select 1 from card_links where id = ${id}`)).toHaveLength(0)
  })

  it('app.copy_board copies links between copied cards', async () => {
    const { id: src, col } = await as(owner.id, async (sql) => {
      const [b] = await sql`select id from app.create_board('Links source')`
      const [c] = await sql`insert into columns (board_id, title, position) values (${b!.id}, 'Todo', 1) returning id`
      return { id: b!.id as string, col: c!.id as string }
    })
    boards.push(src)
    const [a, b, archived] = [await newCard(owner, src, col), await newCard(owner, src, col), await newCard(owner, src, col)]
    await link(owner, a, b, 'blocks', src)
    await link(owner, archived, a, 'relates', src)
    await as(owner.id, sql => sql`update cards set archived_at = now() where id = ${archived}`)
    const copy = await as(owner.id, async sql => (await sql`select id from app.copy_board(${src}, 'Copy', null, true)`)[0]!.id as string)
    boards.push(copy)
    const rows = await as(owner.id, sql => sql`select kind from card_links where board_id = ${copy}`)
    expect(rows.map(r => r.kind)).toEqual(['blocks'])
  })
})
