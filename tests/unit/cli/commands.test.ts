import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardDetail, BoardSummary, Card } from '../../../shared/types/board'
import type { Io } from '../../../cli/src/io'
import { run } from '../../../cli/src/main'
import { AmbiguousError, pick } from '../../../cli/src/resolve'

const token = `kb_${'a'.repeat(43)}`
const B1 = '11111111-1111-4111-8111-111111111111'
const B2 = '22222222-2222-4222-8222-222222222222'
const COL_TODO = 'aaaaaaaa-0000-4000-8000-000000000001'
const COL_DONE = 'aaaaaaaa-0000-4000-8000-000000000002'
const TAG_BUG = 'bbbbbbbb-0000-4000-8000-000000000001'
const TAG_UI = 'bbbbbbbb-0000-4000-8000-000000000002'
const ME = 'cccccccc-0000-4000-8000-000000000001'
const BOB = 'cccccccc-0000-4000-8000-000000000002'
const C1 = 'dddddddd-1000-4000-8000-000000000001'
const C2 = 'dddddddd-2000-4000-8000-000000000002'

function card(id: string, title: string, columnId: string, position: number, extra: Partial<Card> = {}): Card {
  return {
    id, title, columnId, position, description: '', assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null,
    estimate: null, coverAttachmentId: null, checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0,
    watching: false, blockerIds: [], fields: {}, ...extra,
  } as Card
}

const summaries = [
  { id: B1, name: 'Product', role: 'editor', teamId: null, starred: true, archivedAt: null },
  { id: B2, name: 'Product ideas', role: 'viewer', teamId: null, starred: false, archivedAt: null },
] as BoardSummary[]

const board = {
  id: B1, name: 'Product', role: 'editor', archivedAt: null, team: null,
  columns: [{ id: COL_TODO, title: 'To do', wipLimit: null }, { id: COL_DONE, title: 'Done', wipLimit: 3 }],
  tags: [{ id: TAG_BUG, name: 'Bug', color: '#ff0000' }, { id: TAG_UI, name: 'UI', color: '#00ff00' }],
  members: [
    { userId: ME, name: 'Alice', email: 'alice@k.test', role: 'editor', isBot: false },
    { userId: BOB, name: 'Bob', email: 'bob@k.test', role: 'editor', isBot: false },
  ],
  cards: [
    card(C2, 'Second', COL_TODO, 2, { tagIds: [TAG_UI], assigneeIds: [BOB] }),
    card(C1, 'First bug', COL_TODO, 1, { tagIds: [TAG_BUG], assigneeIds: [ME], dueDate: '2026-12-01' }),
  ],
} as unknown as BoardDetail

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kanso-cli-cmd-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

type Call = { method: string, path: string, body: unknown }

/** A fake site with the board above; records writes and echoes the card back. */
function harness() {
  const calls: Call[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const path = url.pathname + url.search
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })
    if (path === '/api/me') return Response.json({ id: ME, name: 'Alice', email: 'alice@k.test', isBot: false, isAdmin: false, locale: null })
    if (path === '/api/boards') return Response.json(summaries)
    if (path === `/api/boards/${B1}`) return Response.json(board)
    if (method === 'PATCH' && path.startsWith('/api/cards/')) {
      const c = board.cards.find(x => path.endsWith(x.id))!
      return Response.json({ ...c, ...body })
    }
    if (method === 'POST' && path === `/api/cards/${C2}/move`) return Response.json({ ...board.cards[0], columnId: body.columnId })
    if (method === 'POST' && path === `/api/boards/${B1}/cards`) return Response.json(card('eeeeeeee-0000-4000-8000-000000000001', body.title, body.columnId, 3))
    return Response.json({ statusCode: 404, message: 'Not found' }, { status: 404 })
  })
  const out: string[] = []
  const err: string[] = []
  const io: Io = {
    env: { KANSO_CONFIG: join(dir, 'config.json'), KANSO_URL: 'https://k.test', KANSO_TOKEN: token },
    home: dir,
    stdout: t => out.push(t),
    stderr: t => err.push(t),
    readSecret: async () => '',
    fetch: fetch as unknown as Io['fetch'],
  }
  return { calls, writes: () => calls.filter(c => c.method !== 'GET'), out: () => out.join(''), err: () => err.join(''), cli: (...argv: string[]) => run(argv, io) }
}

describe('cli name resolution', () => {
  const items = [{ id: 'abcd1234-x', name: 'Product' }, { id: 'abce5678-y', name: 'Product ideas' }, { id: 'ffff0000-z', name: 'Ops' }]
  const find = (ref: string) => pick('board', ref, items, i => i.id, i => [i.name])

  it('prefers an exact name, then an id prefix, then a unique part of a name', () => {
    expect(find('product').id).toBe('abcd1234-x')
    expect(find('abce').id).toBe('abce5678-y')
    expect(find('ide').id).toBe('abce5678-y')
    expect(find('ffff0000-z').name).toBe('Ops')
  })

  it('refuses ambiguous and unknown names, listing the matches', () => {
    expect(() => find('prod')).toThrow(AmbiguousError)
    expect(() => find('prod')).toThrow('"prod" matches 2 boards: Product (abcd1234-x), Product ideas (abce5678-y). Use the id or the full name.')
    expect(() => find('abc')).toThrow('No board matches "abc".')
  })
})

describe('cli board and card commands', () => {
  it('lists boards and shows one by name', async () => {
    const h = harness()
    expect(await h.cli('boards', 'ls')).toBe(0)
    expect(h.out()).toMatch(/^ID +NAME +ROLE +STARRED$/m)
    expect(h.out()).toContain('Product ideas')
    const s = harness()
    expect(await s.cli('board', 'show', 'product', '--json')).toBe(0)
    expect(JSON.parse(s.out())).toMatchObject({ id: B1, columns: [{ title: 'To do', cards: 2 }, { title: 'Done', cards: 0, wipLimit: 3 }] })
  })

  it('reports an ambiguous board with its matches in JSON', async () => {
    const h = harness()
    expect(await h.cli('cards', 'ls', 'prod', '--json')).toBe(1)
    expect(JSON.parse(h.err()).error.matches).toEqual([{ id: B1, name: 'Product' }, { id: B2, name: 'Product ideas' }])
  })

  it('lists cards in board order with filters', async () => {
    const h = harness()
    expect(await h.cli('cards', 'ls', 'Product')).toBe(0)
    const lines = h.out().trim().split('\n')
    expect(lines[1]).toMatch(/^dddddddd +First bug +To do +2026-12-01 +- +Bug +Alice$/)
    expect(lines[2]).toMatch(/^dddddddd +Second/)
    const j = harness()
    expect(await j.cli('card', 'ls', B1, '--tag', 'ui', '--json')).toBe(0)
    expect(JSON.parse(j.out()).map((c: Card) => c.id)).toEqual([C2])
    const me = harness()
    expect(await me.cli('cards', 'ls', 'Product', '--assignee', 'me', '--column', 'to do', '--json')).toBe(0)
    expect(JSON.parse(me.out())).toEqual([expect.objectContaining({ id: C1, assignees: [{ id: ME, name: 'Alice', email: 'alice@k.test' }] })])
  })

  it('adds, moves, edits and archives cards by name', async () => {
    const add = harness()
    expect(await add.cli('card', 'add', 'Product', 'Done', 'New one')).toBe(0)
    expect(add.writes()).toEqual([{ method: 'POST', path: `/api/boards/${B1}/cards`, body: { columnId: COL_DONE, title: 'New one' } }])
    expect(add.out()).toBe('Added eeeeeeee "New one" in Done.\n')

    const mv = harness()
    expect(await mv.cli('card', 'mv', 'Product', 'second', 'to do', '--top')).toBe(0)
    expect(mv.writes()).toEqual([{ method: 'POST', path: `/api/cards/${C2}/move`, body: { columnId: COL_TODO, aboveId: null, belowId: C1 } }])

    const edit = harness()
    expect(await edit.cli('card', 'edit', 'Product', 'dddddddd-1', '--due', 'none', '--priority', 'HIGH', '--add-tag', 'ui', '--remove-tag', 'bug', '--assign', 'bob@k.test', '--unassign', 'me')).toBe(0)
    expect(edit.writes()).toEqual([{ method: 'PATCH', path: `/api/cards/${C1}`, body: { dueDate: null, priority: 'high', tagIds: [TAG_UI], assigneeIds: [BOB] } }])

    const archive = harness()
    expect(await archive.cli('card', 'archive', 'Product', 'First bug')).toBe(0)
    expect(archive.writes()).toEqual([{ method: 'PATCH', path: `/api/cards/${C1}`, body: { archived: true } }])
  })

  it('refuses bad input before calling the site', async () => {
    const h = harness()
    expect(await h.cli('card', 'edit', 'Product', 'First bug', '--due', '2026-02-30')).toBe(2)
    expect(h.err()).toContain('--due must be a date as YYYY-MM-DD, or none.')
    expect(await h.cli('card', 'edit', 'Product', 'First bug')).toBe(2)
    expect(await h.cli('card', 'add', 'Product', 'Done')).toBe(2)
    expect(h.err()).toContain('Missing <title>.')
    expect(h.writes()).toEqual([])
  })

  it('needs a subcommand and shows the group help', async () => {
    const h = harness()
    expect(await h.cli('card')).toBe(2)
    expect(h.err()).toContain('"card" needs a subcommand: ls, show, add, mv, edit, archive')
    const help = harness()
    expect(await help.cli('cards', '--help')).toBe(0)
    expect(help.out()).toContain('card edit')
    const cmd = harness()
    expect(await cmd.cli('help', 'card', 'edit')).toBe(0)
    expect(cmd.out()).toContain('Usage: kanso card edit <board> <card> [options]')
    const unknown = harness()
    expect(await unknown.cli('card', 'fly')).toBe(2)
    expect(unknown.err()).toContain('Unknown command "card fly"')
  })
})
