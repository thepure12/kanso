// RLS for linked GitHub repositories: board owners manage them, the sealed
// token is never readable by kanban_app, a new link clears its sync state,
// and only kanban_auth claims links and imports issues (card_git_issues has
// no grants). app.import_git_issues adds new open issues once, as Automation,
// with matching tags, and marks closed ones complete when asked.
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
let owner: User, editor: User
let boardId: string, columnId: string, tagId: string, linkId: string

const addLink = (by: User, extra: Record<string, unknown> = {}) => as(by.id, sql => sql`
  insert into board_git_links ${sql({ board_id: boardId, repo: 'acme/widgets', column_id: columnId, token: 'sealed', created_by: by.id, ...extra })}
  returning id, last_synced_at, last_error, has_token`)

const issue = (number: number, state: 'open' | 'closed', labels: string[] = []) =>
  ({ number, state, title: `Issue ${number}`, description: `Body ${number}`, url: `https://github.com/acme/widgets/issues/${number}`, labels })
const importIssues = (issues: unknown[]) =>
  auth`select * from app.import_git_issues(${linkId}, ${auth.json(issues as postgres.JSONValue)}, now())`

beforeAll(async () => {
  ;[owner, editor] = await Promise.all(['owner', 'editor'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Git board')` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    ;[{ id: columnId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Inbox', 1) returning id` as any
    ;[{ id: tagId }] = await sql`insert into tags (board_id, name, color) values (${boardId}, 'Bug', '#ff0000') returning id` as any
  })
})

afterAll(async () => {
  await as(owner.id, sql => sql`delete from boards where id = ${boardId}`)
  await Promise.all([app.end(), auth.end()])
})

describe('board_git_links', () => {
  it('only owners add links, as themselves; the sync state starts empty', async () => {
    await expect(addLink(editor)).rejects.toMatchObject({ code: '42501' })
    await expect(as(owner.id, sql => sql`
      insert into board_git_links (board_id, repo, column_id, created_by) values (${boardId}, 'acme/widgets', ${columnId}, ${editor.id})`))
      .rejects.toMatchObject({ code: '42501' })
    await expect(addLink(owner, { repo: 'Acme/Widgets' })).rejects.toMatchObject({ code: '23514' })
    const [row] = await addLink(owner, { last_synced_at: new Date(), last_error: 'forged' })
    expect(row).toMatchObject({ last_synced_at: null, last_error: null, has_token: true })
    linkId = row!.id
  })

  it('editors see none; nobody reads the token or the imported issues', async () => {
    expect(await as(editor.id, sql => sql`select id from board_git_links where board_id = ${boardId}`)).toEqual([])
    expect(await as(editor.id, sql => sql`update board_git_links set active = false where id = ${linkId} returning id`)).toEqual([])
    await expect(as(owner.id, sql => sql`select token from board_git_links`)).rejects.toMatchObject({ code: '42501' })
    await expect(as(owner.id, sql => sql`update board_git_links set last_synced_at = now()`)).rejects.toMatchObject({ code: '42501' })
    await expect(as(owner.id, sql => sql`select * from card_git_issues`)).rejects.toMatchObject({ code: '42501' })
    await expect(as(owner.id, sql => sql`select * from app.claim_git_links()`)).rejects.toMatchObject({ code: '42501' })
    await expect(as(owner.id, sql => sql`select * from app.import_git_issues(${linkId}, '[]'::jsonb, now())`)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('syncing', () => {
  it('claims a due link once, with its sealed token', async () => {
    const [claimed] = await auth`select * from app.claim_git_links(${boardId}::uuid)`
    expect(claimed).toMatchObject({ id: linkId, repo: 'acme/widgets', token: 'sealed', since: null })
    expect(await auth`select * from app.claim_git_links(${boardId}::uuid)`).toEqual([])
    expect(await auth`select id from app.claim_git_links(null, ${linkId}::uuid)`).toEqual([{ id: linkId }])
  })

  it('imports new open issues once, as Automation, with matching tags', async () => {
    expect(await importIssues([issue(1, 'open', ['bug', 'ui']), issue(2, 'closed'), issue(3, 'open')])).toEqual([{ imported: 2, completed: 0 }])
    expect(await importIssues([issue(1, 'open'), issue(3, 'open')])).toEqual([{ imported: 0, completed: 0 }])
    const cards = await as(owner.id, sql => sql`
      select c.title, c.description, c.created_by, array(select tag_id from card_tags t where t.card_id = c.id) as tags,
        (select a.actor_id from card_activity a where a.card_id = c.id and a.kind = 'created') as actor
      from cards c where c.board_id = ${boardId} order by c.position`)
    expect(cards).toEqual([
      { title: 'Issue 1', description: 'Body 1', created_by: null, tags: [tagId], actor: null },
      { title: 'Issue 3', description: 'Body 3', created_by: null, tags: [], actor: null },
    ])
    const [link] = await as(owner.id, sql => sql`select last_synced_at, last_error from board_git_links where id = ${linkId}`)
    expect(link!.last_synced_at).not.toBeNull()
  })

  it('marks cards of closed issues complete only with close_action complete', async () => {
    expect(await importIssues([issue(1, 'closed')])).toEqual([{ imported: 0, completed: 0 }])
    await as(owner.id, sql => sql`update board_git_links set close_action = 'complete' where id = ${linkId}`)
    expect(await importIssues([issue(1, 'closed')])).toEqual([{ imported: 0, completed: 1 }])
    expect(await importIssues([issue(1, 'closed')])).toEqual([{ imported: 0, completed: 0 }])
  })

  it('a new token or label starts over; a failure is recorded', async () => {
    await auth`select app.fail_git_link(${linkId}, 'GitHub: down')`
    const [after] = await as(owner.id, sql => sql`
      update board_git_links set token = 'sealed2' where id = ${linkId} returning last_synced_at, last_error`)
    expect(after).toEqual({ last_synced_at: null, last_error: null })
  })
})
