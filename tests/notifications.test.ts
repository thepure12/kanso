// Fan-out and RLS tests for notifications. Same setup as rls.test.ts.
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
let boardId: string
let todoId: string
let doneId: string
const boards: string[] = []

const newCard = (...assignees: string[]) =>
  as(owner.id, async (sql) => {
    const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'Card', 1, ${owner.id}) returning id`
    for (const u of assignees) await sql`insert into card_assignees (card_id, user_id, board_id) values (${c!.id}, ${u}, ${boardId})`
    return c!.id as string
  })

const inbox = (userId: string, cardId: string) =>
  as(userId, async sql => (await sql`
    select a.kind from notifications n join card_activity a on a.id = n.activity_id
    where n.card_id = ${cardId} order by a.created_at, a.id`).map(r => r.kind as string))

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Notifications board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Done', 2) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
  boards.push(boardId)
})

afterAll(async () => {
  for (const b of boards) await as(owner.id, sql => sql`delete from boards where id = ${b}`)
  await Promise.all([app.end(), auth.end()])
})

describe('fan-out', () => {
  it('notifies assignees of assignment, comments, moves, due dates and archiving, never the actor', async () => {
    const id = await newCard(editor.id, owner.id)
    await as(owner.id, async (sql) => {
      await sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${owner.id}, 'hi')`
      await sql`update cards set column_id = ${doneId}, due_date = '2026-12-01', title = 'Renamed', priority = 'high' where id = ${id}`
      await sql`update cards set archived_at = now() where id = ${id}`
    })
    expect(await inbox(editor.id, id)).toEqual(['assigned', 'commented', 'moved', 'due', 'archived'])
    expect(await inbox(owner.id, id)).toEqual([])
  })

  it('notifies only the user being assigned', async () => {
    const id = await newCard(editor.id)
    await as(owner.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${viewer.id}, ${boardId})`)
    expect(await inbox(editor.id, id)).toEqual(['assigned'])
    expect(await inbox(viewer.id, id)).toEqual(['assigned'])
  })

  it('skips assignees who lost access to the board', async () => {
    const id = await newCard(viewer.id)
    await as(owner.id, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${viewer.id}`)
    await as(owner.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${owner.id}, 'gone')`)
    await as(owner.id, sql => sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`)
    // Only the assignment from before the removal; the comment fanned out to nobody.
    expect(await inbox(viewer.id, id)).toEqual(['assigned'])
  })

  it('does not notify on a board copy', async () => {
    await newCard(editor.id)
    const copy = await as(owner.id, async sql => (await sql`select id from app.copy_board(${boardId}, 'Copy', null, true)`)[0]!.id as string)
    boards.push(copy)
    const [{ n }] = await as(editor.id, sql => sql`select count(*)::int as n from notifications where board_id = ${copy}`)
    expect(n).toBe(0)
  })

  it('sends NOTIFY user_notifications to each recipient', async () => {
    const got: { u: string }[] = []
    const listener = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
    await listener.listen('user_notifications', p => got.push(JSON.parse(p)))
    await newCard(editor.id, viewer.id)
    await new Promise(r => setTimeout(r, 200))
    await listener.end()
    expect(got).toEqual(expect.arrayContaining([{ u: editor.id }, { u: viewer.id }]))
    expect(got.some(g => g.u === owner.id)).toBe(false)
  })
})

describe('rls', () => {
  it('users read, mark read and delete only their own', async () => {
    const id = await newCard(editor.id)
    const [{ nid }] = await as(editor.id, sql => sql`select id as nid from notifications where card_id = ${id}`) as any
    expect(await as(viewer.id, sql => sql`select id from notifications where id = ${nid}`)).toHaveLength(0)
    expect((await as(viewer.id, sql => sql`update notifications set read_at = now() where id = ${nid}`)).count).toBe(0)
    expect((await as(viewer.id, sql => sql`delete from notifications where id = ${nid}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`update notifications set read_at = now() where id = ${nid}`)).count).toBe(1)
    await rejectsWith(as(editor.id, sql => sql`update notifications set user_id = ${viewer.id} where id = ${nid}`), '42501')
    expect((await as(editor.id, sql => sql`delete from notifications where id = ${nid}`)).count).toBe(1)
  })

  it('kanban_app cannot insert', async () => {
    const id = await newCard()
    const [{ aid }] = await as(owner.id, sql => sql`select id as aid from card_activity where card_id = ${id}`) as any
    await rejectsWith(as(outsider.id, sql => sql`insert into notifications (user_id, card_id, board_id, activity_id) values (${outsider.id}, ${id}, ${boardId}, ${aid})`), '42501')
  })

  it('hides notifications of boards the user lost access to', async () => {
    const id = await newCard(viewer.id)
    expect(await inbox(viewer.id, id)).toEqual(['assigned'])
    await as(owner.id, sql => sql`delete from board_members where board_id = ${boardId} and user_id = ${viewer.id}`)
    expect(await inbox(viewer.id, id)).toEqual([])
    await as(owner.id, sql => sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`)
  })
})

describe('mentions', () => {
  const mention = (u: User, name = 'Someone') => `@[${name}](user:${u.id})`
  const comment = (author: User, cardId: string, body: string) =>
    as(author.id, async sql => (await sql`insert into card_comments (card_id, board_id, author_id, body) values (${cardId}, ${boardId}, ${author.id}, ${body}) returning id`)[0]!.id as string)

  it('notifies mentioned members who are not assignees, not outsiders or the author', async () => {
    const id = await newCard()
    await comment(owner, id, `hey ${mention(viewer)} and ${mention(outsider)} and ${mention(owner)}`)
    expect(await inbox(viewer.id, id)).toEqual(['commented'])
    expect(await inbox(outsider.id, id)).toEqual([])
    expect(await inbox(owner.id, id)).toEqual([])
    const [a] = await as(viewer.id, sql => sql`select data from card_activity where card_id = ${id} and kind = 'commented'`)
    expect(a!.data.mentions).toEqual(expect.arrayContaining([viewer.id, outsider.id, owner.id]))
  })

  it('notifies an assignee who is also mentioned once', async () => {
    const id = await newCard(editor.id)
    await comment(owner, id, `cc ${mention(editor)}`)
    expect(await inbox(editor.id, id)).toEqual(['assigned', 'commented'])
  })

  it('an edit notifies only people newly mentioned', async () => {
    const id = await newCard()
    const cid = await comment(owner, id, `first ${mention(viewer)}`)
    await as(owner.id, sql => sql`update card_comments set body = ${`edited ${mention(viewer)} ${mention(editor)}`} where id = ${cid}`)
    await as(owner.id, sql => sql`update card_comments set body = ${`again ${mention(viewer)} ${mention(editor)}`} where id = ${cid}`)
    expect(await inbox(viewer.id, id)).toEqual(['commented'])
    expect(await inbox(editor.id, id)).toEqual(['mentioned'])
  })

  it('ignores malformed tokens', async () => {
    const id = await newCard()
    await comment(owner, id, '@[x](user:not-a-uuid) @[y](user:------------------------------------)')
    expect(await inbox(viewer.id, id)).toEqual([])
  })
})
