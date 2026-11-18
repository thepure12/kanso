// Commenter role (0092_commenter_role_rls.sql): reads like a viewer, but also
// comments, logs time, watches and reacts on cards they can see. No other
// card or board changes.
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

async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name, email_verified_at) values (${`${name}-${randomUUID()}@test.local`}, ${name}, now()) returning id, email`
  return u as { id: string, email: string }
}

type User = { id: string, email: string }
let boardOwner: User, commenter: User, viewer: User, teamCommenter: User
let boardId: string, teamId: string, teamBoardId: string
let colId: string, hiddenCol: string, cardId: string, hiddenCard: string

const comment = (u: User, card: string, board = boardId) => as(u.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body)
  values (${card}, ${board}, ${u.id}, 'hello') returning id`)
const logTime = (u: User, card: string) => as(u.id, sql => sql`insert into time_entries (card_id, board_id, user_id, minutes, spent_on)
  values (${card}, ${boardId}, ${u.id}, 15, current_date) returning id`)

beforeAll(async () => {
  ;[boardOwner, commenter, viewer, teamCommenter] = await Promise.all(['owner', 'commenter', 'viewer', 'team-commenter'].map(createUser)) as User[]
  await as(boardOwner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Commenter board')` as any
    ;[{ id: colId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: hiddenCol }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Hidden', 2) returning id` as any
    ;[{ id: cardId }] = await sql`insert into cards (board_id, column_id, title, position, created_by)
      values (${boardId}, ${colId}, 'Card', 1, ${boardOwner.id}) returning id` as any
    ;[{ id: hiddenCard }] = await sql`insert into cards (board_id, column_id, title, position, created_by)
      values (${boardId}, ${hiddenCol}, 'Hidden card', 1, ${boardOwner.id}) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${commenter.email}, 'commenter')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
    ;[{ id: teamId }] = await sql`select id from app.create_team('Commenter team')` as any
    await sql`select app.add_team_member(${teamId}, ${teamCommenter.email}, 'commenter')`
    ;[{ id: teamBoardId }] = await sql`select id from app.create_board('Team board', ${teamId})` as any
  })
})

afterAll(async () => {
  await owner`delete from boards where id = any(${[boardId, teamBoardId]})`
  await owner`delete from teams where id = ${teamId}`
  await owner`delete from users where id = any(${[boardOwner, commenter, viewer, teamCommenter].map(u => u.id)})`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('commenter role', () => {
  it('sits between editor and viewer', async () => {
    const [r] = await as(commenter.id, sql => sql`select app.board_role(${boardId}) as role, app.can_edit(${boardId}) as edit`)
    expect(r).toMatchObject({ role: 'commenter', edit: false })
    // A team commenter is a commenter on every board of the team.
    const [t] = await as(teamCommenter.id, sql => sql`select app.board_role(${teamBoardId}) as role`)
    expect(t!.role).toBe('commenter')
  })

  it('reads cards but cannot change them', async () => {
    expect(await as(commenter.id, sql => sql`select id from cards where board_id = ${boardId}`)).toHaveLength(2)
    expect((await as(commenter.id, sql => sql`update cards set title = 'x' where id = ${cardId}`)).count).toBe(0)
    await rejectsWith(as(commenter.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by)
      values (${boardId}, ${colId}, 'New', 9, ${commenter.id})`), '42501')
    await rejectsWith(as(commenter.id, sql => sql`insert into checklist_items (card_id, board_id, text, position)
      values (${cardId}, ${boardId}, 'x', 1)`), '42501')
    await rejectsWith(as(commenter.id, sql => sql`insert into card_attachments (card_id, board_id, name, content_type, size, data, uploaded_by)
      values (${cardId}, ${boardId}, 'a.txt', 'text/plain', 1, '\\x00', ${commenter.id})`), '42501')
    await rejectsWith(as(commenter.id, sql => sql`insert into columns (board_id, title, position) values (${boardId}, 'x', 9)`), '42501')
  })

  it('comments, edits and deletes their own comments', async () => {
    const [c] = await comment(commenter, cardId)
    expect((await as(commenter.id, sql => sql`update card_comments set body = 'edited' where id = ${c!.id}`)).count).toBe(1)
    const [other] = await comment(boardOwner, cardId)
    expect((await as(commenter.id, sql => sql`update card_comments set body = 'x' where id = ${other!.id}`)).count).toBe(0)
    expect((await as(commenter.id, sql => sql`delete from card_comments where id = ${other!.id}`)).count).toBe(0)
    expect((await as(commenter.id, sql => sql`delete from card_comments where id = ${c!.id}`)).count).toBe(1)
    // Team commenters too.
    const [tcol] = await as(boardOwner.id, sql => sql`insert into columns (board_id, title, position) values (${teamBoardId}, 'T', 1) returning id`)
    const [tcard] = await as(boardOwner.id, sql => sql`insert into cards (board_id, column_id, title, position, created_by)
      values (${teamBoardId}, ${tcol!.id}, 'T', 1, ${boardOwner.id}) returning id`)
    await comment(teamCommenter, tcard!.id, teamBoardId)
  })

  it('logs and manages their own time', async () => {
    const [e] = await logTime(commenter, cardId)
    expect((await as(commenter.id, sql => sql`update time_entries set minutes = 30 where id = ${e!.id}`)).count).toBe(1)
    expect((await as(commenter.id, sql => sql`delete from time_entries where id = ${e!.id}`)).count).toBe(1)
  })

  it('watches cards', async () => {
    await as(commenter.id, sql => sql`delete from card_watchers where card_id = ${cardId} and user_id = ${commenter.id}`)
    await as(commenter.id, sql => sql`insert into card_watchers (card_id, board_id, user_id) values (${cardId}, ${boardId}, ${commenter.id})`)
  })

  it('leaves viewers read-only', async () => {
    await rejectsWith(comment(viewer, cardId), '42501')
    await rejectsWith(logTime(viewer, cardId), '42501')
  })

  it('follows access limits: comments on readable cards only', async () => {
    await as(boardOwner.id, async (sql) => {
      await sql`insert into board_member_limits (board_id, user_id, default_access) values (${boardId}, ${commenter.id}, 'read')`
      await sql`insert into board_member_access (board_id, user_id, column_id, access) values (${boardId}, ${commenter.id}, ${hiddenCol}, 'none')`
    })
    try {
      expect(await as(commenter.id, sql => sql`select id from cards where board_id = ${boardId}`)).toHaveLength(1)
      await comment(commenter, cardId)
      await rejectsWith(comment(commenter, hiddenCard), '42501')
      await rejectsWith(logTime(commenter, hiddenCard), '42501')
    }
    finally {
      await owner`delete from board_member_limits where board_id = ${boardId} and user_id = ${commenter.id}`
      await owner`delete from board_member_access where board_id = ${boardId} and user_id = ${commenter.id}`
    }
  })

  it('stops on archived boards', async () => {
    await as(boardOwner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    try {
      await rejectsWith(comment(commenter, cardId), '42501')
      await rejectsWith(logTime(commenter, cardId), '42501')
    }
    finally {
      await as(boardOwner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
    }
  })
})
