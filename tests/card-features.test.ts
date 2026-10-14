// RLS and trigger tests for assignees, checklists, comments, attachments,
// activity, board change notifications and app.copy_board. Same setup as rls.test.ts.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>, clientId?: string) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    if (clientId) await sql`select set_config('app.client_id', ${clientId}, true)`
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

const newCard = (title = 'Card', columnId = todoId) =>
  as(editor.id, async sql => (await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${columnId}, ${title}, 1, ${editor.id}) returning id`)[0]!.id as string)

const activityOf = (cardId: string) =>
  as(owner.id, async sql => (await sql`select kind, data, actor_id from card_activity where card_id = ${cardId} order by created_at, id`)
    .map(r => ({ kind: r.kind as string, data: r.data as Record<string, unknown>, actorId: r.actor_id as string | null })))

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Features board')` as any
    ;[{ id: todoId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
    ;[{ id: doneId }] = await sql`insert into columns (board_id, title, position, wip_limit) values (${boardId}, 'Done', 2, 3) returning id` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
  })
  boards.push(boardId)
})

afterAll(async () => {
  for (const b of boards) await as(owner.id, sql => sql`delete from boards where id = ${b}`)
  await Promise.all([app.end(), auth.end()])
})

describe('cards', () => {
  it('stores due date, priority and archive state; editors only', async () => {
    const id = await newCard()
    await as(editor.id, sql => sql`update cards set due_date = '2026-12-01', priority = 'high', archived_at = now() where id = ${id}`)
    const [row] = await as(viewer.id, sql => sql`select due_date::text as due, priority, archived_at is not null as archived from cards where id = ${id}`)
    expect(row).toEqual({ due: '2026-12-01', priority: 'high', archived: true })
    expect((await as(viewer.id, sql => sql`update cards set priority = 'low' where id = ${id}`)).count).toBe(0)
    await rejectsWith(as(editor.id, sql => sql`update cards set priority = 'whenever' where id = ${id}`), '22P02')
  })

  it('wip_limit must be 1-999', async () => {
    await rejectsWith(as(owner.id, sql => sql`update columns set wip_limit = 0 where id = ${todoId}`), '23514')
  })
})

describe('card_assignees', () => {
  it('editors assign board members; viewers and outsiders cannot', async () => {
    const id = await newCard()
    await as(editor.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${viewer.id}, ${boardId}), (${id}, ${owner.id}, ${boardId})`)
    expect(await as(viewer.id, sql => sql`select user_id from card_assignees where card_id = ${id}`)).toHaveLength(2)
    await rejectsWith(as(editor.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${outsider.id}, ${boardId})`), '42501')
    await rejectsWith(as(viewer.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${editor.id}, ${boardId})`), '42501')
    expect((await as(viewer.id, sql => sql`delete from card_assignees where card_id = ${id}`)).count).toBe(0)
    expect(await as(outsider.id, sql => sql`select user_id from card_assignees where card_id = ${id}`)).toHaveLength(0)
  })

  it('cannot point at a card of another board', async () => {
    const id = await newCard()
    const other = await as(outsider.id, async sql => (await sql`select id from app.create_board('Outsider board')`)[0]!.id as string)
    await rejectsWith(as(outsider.id, sql => sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${outsider.id}, ${other})`), '23503')
    await as(outsider.id, sql => sql`delete from boards where id = ${other}`)
  })
})

describe('checklist_items', () => {
  it('editors add, tick and delete; viewers read only', async () => {
    const id = await newCard()
    const [item] = await as(editor.id, sql => sql`insert into checklist_items (card_id, board_id, text, position) values (${id}, ${boardId}, 'Step', 1024) returning id`)
    await as(editor.id, sql => sql`update checklist_items set done = true where id = ${item!.id}`)
    const [row] = await as(viewer.id, sql => sql`select done from checklist_items where id = ${item!.id}`)
    expect(row?.done).toBe(true)
    expect((await as(viewer.id, sql => sql`update checklist_items set done = false where id = ${item!.id}`)).count).toBe(0)
    await rejectsWith(as(viewer.id, sql => sql`insert into checklist_items (card_id, board_id, text, position) values (${id}, ${boardId}, 'x', 1)`), '42501')
    await rejectsWith(as(editor.id, sql => sql`update checklist_items set card_id = ${id} where id = ${item!.id}`), '42501')
    expect((await as(editor.id, sql => sql`delete from checklist_items where id = ${item!.id}`)).count).toBe(1)
  })
})

describe('card_comments', () => {
  it('editors comment as themselves; authors edit; authors and owners delete', async () => {
    const id = await newCard()
    await rejectsWith(as(editor.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${owner.id}, 'spoof')`), '42501')
    await rejectsWith(as(viewer.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${viewer.id}, 'hi')`), '42501')
    const [c] = await as(editor.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${editor.id}, 'hi') returning id`)

    expect(await as(viewer.id, sql => sql`select body from card_comments where id = ${c!.id}`)).toEqual([{ body: 'hi' }])
    expect((await as(owner.id, sql => sql`update card_comments set body = 'owner edit' where id = ${c!.id}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`update card_comments set body = 'edited' where id = ${c!.id}`)).count).toBe(1)
    await rejectsWith(as(editor.id, sql => sql`update card_comments set author_id = ${owner.id} where id = ${c!.id}`), '42501')

    const [c2] = await as(editor.id, sql => sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${editor.id}, 'second') returning id`)
    expect((await as(viewer.id, sql => sql`delete from card_comments where id = ${c!.id}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`delete from card_comments where id = ${c!.id}`)).count).toBe(1)
    expect((await as(owner.id, sql => sql`delete from card_comments where id = ${c2!.id}`)).count).toBe(1)
  })
})

describe('card_attachments', () => {
  it('editors upload as themselves; size must match; viewers download only', async () => {
    const id = await newCard()
    const data = Buffer.from('hello')
    await rejectsWith(as(editor.id, sql => sql`insert into card_attachments (card_id, board_id, name, content_type, size, data, uploaded_by) values (${id}, ${boardId}, 'a.txt', 'text/plain', 99, ${data}, ${editor.id})`), '23514')
    await rejectsWith(as(editor.id, sql => sql`insert into card_attachments (card_id, board_id, name, content_type, size, data, uploaded_by) values (${id}, ${boardId}, 'a.txt', 'text/plain', 5, ${data}, ${owner.id})`), '42501')
    await rejectsWith(as(viewer.id, sql => sql`insert into card_attachments (card_id, board_id, name, content_type, size, data, uploaded_by) values (${id}, ${boardId}, 'a.txt', 'text/plain', 5, ${data}, ${viewer.id})`), '42501')
    const [a] = await as(editor.id, sql => sql`insert into card_attachments (card_id, board_id, name, content_type, size, data, uploaded_by) values (${id}, ${boardId}, 'a.txt', 'text/plain', 5, ${data}, ${editor.id}) returning id`)

    const [row] = await as(viewer.id, sql => sql`select data from card_attachments where id = ${a!.id}`)
    expect(Buffer.from(row!.data).toString()).toBe('hello')
    expect(await as(outsider.id, sql => sql`select id from card_attachments where id = ${a!.id}`)).toHaveLength(0)
    expect((await as(viewer.id, sql => sql`delete from card_attachments where id = ${a!.id}`)).count).toBe(0)
    expect((await as(editor.id, sql => sql`delete from card_attachments where id = ${a!.id}`)).count).toBe(1)
  })
})

describe('card_activity', () => {
  it('logs card changes as the acting user', async () => {
    const id = await newCard('First')
    const tagId = await as(owner.id, async sql => (await sql`insert into tags (board_id, name, color) values (${boardId}, ${`t-${randomUUID()}`}, '#000000') returning id`)[0]!.id as string)
    await as(editor.id, async (sql) => {
      await sql`update cards set title = 'Second', description = 'x', due_date = '2026-11-01', priority = 'urgent' where id = ${id}`
      await sql`update cards set column_id = ${doneId} where id = ${id}`
      await sql`update cards set position = 7 where id = ${id}`
      await sql`insert into card_tags (card_id, tag_id, board_id) values (${id}, ${tagId}, ${boardId})`
      await sql`delete from card_tags where card_id = ${id}`
      await sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${viewer.id}, ${boardId})`
      await sql`delete from card_assignees where card_id = ${id}`
      await sql`insert into card_comments (card_id, board_id, author_id, body) values (${id}, ${boardId}, ${editor.id}, 'hi')`
      await sql`update cards set archived_at = now() where id = ${id}`
      await sql`update cards set archived_at = null where id = ${id}`
    })
    const log = await activityOf(id)
    expect(log.map(l => l.kind)).toEqual([
      'created', 'renamed', 'described', 'due', 'priority', 'moved', 'tagged', 'untagged',
      'assigned', 'unassigned', 'commented', 'archived', 'restored',
    ])
    expect(log.every(l => l.actorId === editor.id)).toBe(true)
    expect(log[1]!.data).toEqual({ from: 'First', to: 'Second' })
    expect(log[5]!.data).toEqual({ from: 'Todo', to: 'Done' })
    expect(log[8]!.data).toEqual({ user: 'viewer', user_id: viewer.id })
  })

  it('is read-only for kanban_app and hidden from outsiders', async () => {
    const id = await newCard()
    await rejectsWith(as(owner.id, sql => sql`insert into card_activity (card_id, board_id, kind) values (${id}, ${boardId}, 'fake')`), '42501')
    await rejectsWith(as(owner.id, sql => sql`select app.log_activity(${id}, ${boardId}, 'fake')`), '42501')
    expect(await as(viewer.id, sql => sql`select id from card_activity where card_id = ${id}`)).toHaveLength(1)
    expect(await as(outsider.id, sql => sql`select id from card_activity where card_id = ${id}`)).toHaveLength(0)
  })

  it('deleting a card or tag with related rows still works', async () => {
    const id = await newCard()
    const tagId = await as(owner.id, async sql => (await sql`insert into tags (board_id, name, color) values (${boardId}, ${`t-${randomUUID()}`}, '#000000') returning id`)[0]!.id as string)
    const other = await newCard()
    await as(editor.id, async (sql) => {
      await sql`insert into card_tags (card_id, tag_id, board_id) values (${id}, ${tagId}, ${boardId}), (${other}, ${tagId}, ${boardId})`
      await sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${viewer.id}, ${boardId})`
      await sql`insert into card_attachments (card_id, board_id, name, content_type, size, data, uploaded_by) values (${id}, ${boardId}, 'a', 'text/plain', 1, ${Buffer.from('a')}, ${editor.id})`
    })
    expect((await as(editor.id, sql => sql`delete from cards where id = ${id}`)).count).toBe(1)
    await as(owner.id, sql => sql`delete from tags where id = ${tagId}`)
    expect((await activityOf(other)).map(l => l.kind)).toEqual(['created', 'tagged'])
  })
})

describe('board change notifications', () => {
  it('notifies once per board and transaction with the client id', async () => {
    const got: { b: string, c: string }[] = []
    const listener = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
    await listener.listen('board_changes', p => got.push(JSON.parse(p)))
    await as(editor.id, async (sql) => {
      const [c] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${todoId}, 'n', 1, ${editor.id}) returning id`
      await sql`update cards set title = 'n2' where id = ${c!.id}`
    }, 'tab-1')
    await new Promise(r => setTimeout(r, 200))
    await listener.end()
    expect(got.filter(g => g.b === boardId)).toEqual([{ b: boardId, c: 'tab-1' }])
  })
})

describe('app.copy_board', () => {
  it('copies columns, tags, rules and cards the caller can see', async () => {
    const id = await newCard('Copied', doneId)
    const archived = await newCard('Archived')
    const tagId = await as(owner.id, async (sql) => {
      const [t] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'copy-tag', '#123456') returning id`
      await sql`insert into card_tags (card_id, tag_id, board_id) values (${id}, ${t!.id}, ${boardId})`
      await sql`insert into card_assignees (card_id, user_id, board_id) values (${id}, ${viewer.id}, ${boardId}), (${id}, ${editor.id}, ${boardId})`
      await sql`insert into checklist_items (card_id, board_id, text, done, position) values (${id}, ${boardId}, 'step', true, 1)`
      await sql`insert into column_rules (board_id, column_id, kind, user_id) values (${boardId}, ${todoId}, 'assign_to', ${viewer.id})`
      await sql`insert into column_rules (board_id, column_id, kind, tag_id) values (${boardId}, ${doneId}, 'apply_tag', ${t!.id})`
      await sql`update cards set archived_at = now() where id = ${archived}`
      return t!.id as string
    })

    // Editor copies into a personal board: only the editor has access there.
    const copy = await as(editor.id, async (sql) => {
      const [b] = await sql`select id from app.copy_board(${boardId}, 'Copy', null, true)`
      return b!.id as string
    })
    boards.push(copy)
    await as(editor.id, async (sql) => {
      expect((await sql`select title, wip_limit from columns where board_id = ${copy} order by position`).map(r => [r.title, r.wip_limit]))
        .toEqual([['Todo', null], ['Done', 3]])
      const cards = await sql`select id, title from cards where board_id = ${copy}`
      expect(cards.map(c => c.title)).not.toContain('Archived')
      const copied = cards.find(c => c.title === 'Copied')!
      const [tag] = await sql`select t.name from card_tags ct join tags t on t.id = ct.tag_id where ct.card_id = ${copied.id}`
      expect(tag?.name).toBe('copy-tag')
      expect((await sql`select user_id from card_assignees where card_id = ${copied.id}`).map(r => r.user_id)).toEqual([editor.id])
      expect(await sql`select text, done from checklist_items where card_id = ${copied.id}`).toEqual([{ text: 'step', done: true }])
      // assign_to viewer dropped (no access); apply_tag points at the copied tag.
      const rules = await sql`select kind, tag_id from column_rules where board_id = ${copy}`
      expect(rules).toHaveLength(1)
      expect(rules[0]!.tag_id).not.toBe(tagId)
    })
  })

  it('needs access to the source', async () => {
    await rejectsWith(as(outsider.id, sql => sql`select id from app.copy_board(${boardId}, 'Steal', null, true)`), '42501')
  })
})
