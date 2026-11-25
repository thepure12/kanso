import { describe, expect, it, vi } from 'vitest'
import type { BoardDetail, CardDetail } from '../../../shared/types/board'
import type { Inbox, Notification } from '../../../shared/types/notifications'
import { type AgentRule, agentRuleSettleDefaults as sharedSettleDefaults } from '../../../shared/types/board'
import { AGENT_CLIENT_ID, type AgentDeps, type AgentOptions, agentRuleSettleDefaults, backoff, changeMarker, BoardGoneError, type CardContext, type ExecResult, type Job, ruleSkipReason, rulesForEvent, runAgent, settleSeconds, statusComment, streamQuery } from '../../../cli/src/agent'
import { createClient } from '../../../cli/src/client'
import { claudePrompt, resolveColumns, splitList } from '../../../cli/src/commands/agent'
import { readServerEvents } from '../../../cli/src/sse'

const B = '11111111-1111-4111-8111-111111111111'
const TODO = '22222222-2222-4222-8222-222222222222'
const DONE = '33333333-3333-4333-8333-333333333333'
const BOT = '44444444-4444-4444-8444-444444444444'
const BUG = '55555555-5555-4555-8555-555555555555'
const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, columnId: TODO, title: `Card ${id}`, tagIds: [], assigneeIds: [], ...extra })
const board = {
  id: B, name: 'Kanso', columns: [{ id: TODO, title: 'To do' }, { id: DONE, title: 'Done' }],
  cards: [card('c1'), card('c2'), card('c3', { tagIds: [BUG] }), card('c4', { columnId: DONE })], tags: [{ id: BUG, name: 'bug', color: '#f00' }],
} as unknown as BoardDetail
const detail = { checklists: [], comments: [], links: [], activity: [] } as unknown as CardDetail

/** A controllable SSE response body. */
function stream() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => { ctrl = c } })
  const enc = new TextEncoder()
  return {
    body,
    send: (event: string, data: unknown = '') => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)),
    end: () => ctrl.close(),
  }
}

const notification = (id: string, cardId: string, boardId = B): Notification => ({
  id, boardId, boardName: 'Kanso', cardId, cardTitle: 'x', readAt: null,
  activity: { id: `act-${id}`, actorId: 'u2', actorName: 'Bob', kind: 'commented', data: { mentions: [] }, createdAt: '2026-01-01T00:00:00Z' },
} as Notification)

const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise(r => setTimeout(r, 5))
  expect(fn()).toBe(true)
}

function harness(opts: Partial<AgentOptions> = {}, inbox: Notification[] = [], agentRules: AgentRule[] = [], details: Record<string, CardDetail> = {}, sleep: AgentDeps['sleep'] = async () => {}) {
  const streams: ReturnType<typeof stream>[] = []
  const requests: { method: string, url: string, body?: unknown, clientId: string | null }[] = []
  const stop = new AbortController()
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined, clientId: new Headers(init.headers).get('x-client-id') })
    if (url.includes('/api/events?')) {
      const s = stream()
      streams.push(s)
      init.signal?.addEventListener('abort', () => { try { s.end() } catch {} })
      return new Response(s.body, { headers: { 'content-type': 'text/event-stream' } })
    }
    if (url.endsWith(`/api/boards/${B}`)) return Response.json(board)
    if (url.endsWith(`/api/boards/${B}/agent-rules`)) return Response.json(agentRules)
    if (/\/api\/cards\/c\d$/.test(url)) return Response.json(details[url.slice(-2)] ?? detail)
    if (method === 'POST' && url.endsWith('/move')) return Response.json({})
    if (url.includes('/api/notifications?')) return Response.json({ items: inbox.filter(n => !n.readAt) } as Partial<Inbox>)
    if (method === 'PATCH' && url.includes('/api/notifications/')) {
      const n = inbox.find(i => url.endsWith(i.id))
      if (n) n.readAt = 'now'
      return Response.json({ id: n?.id })
    }
    if (method === 'POST' && url.endsWith('/comments')) return Response.json({})
    return Response.json({ message: 'nope' }, { status: 404 })
  })
  const runs: { job: Job, env: Record<string, string>, stdin: string, finish: (r?: Partial<ExecResult>) => void }[] = []
  const options: AgentOptions = { url: 'https://k.test', token: 'kb_x', boardIds: [B], activity: ['created', 'moved'], columnIds: [TODO], notifications: false, concurrency: 1, comment: 'never', ...opts }
  const deps: AgentDeps = {
    client: createClient({ url: 'https://k.test', token: 'kb_x' }, fetch as unknown as typeof globalThis.fetch, AGENT_CLIENT_ID),
    fetch: fetch as unknown as typeof globalThis.fetch,
    log: () => {},
    sleep: vi.fn(sleep),
    signal: stop.signal,
    exec: (job, env, stdin) => new Promise(resolve => runs.push({ job, env, stdin, finish: r => resolve({ code: 0, signal: null, timedOut: false, ...r }) })),
  }
  const done = runAgent(options, deps)
  return { streams, requests, runs, deps, done, stop: () => stop.abort(), agentRules }
}

describe('kanso agent run', () => {
  it('builds the stream query', () => {
    expect(streamQuery({ boardIds: [B], activity: ['moved'], columnIds: [TODO], notifications: true }))
      .toBe(`boards=${B}&notifications=1&activity=moved&change=0&columns=${TODO}&clients=kanso-agent`)
    expect(streamQuery({ boardIds: [], activity: [], columnIds: [], notifications: true })).toBe('notifications=1&clients=kanso-agent')
    expect([0, 1, 5, 10].map(backoff)).toEqual([1000, 2000, 32_000, 60_000])
  })

  it('parses server-sent events across chunks', async () => {
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(': hi\nevent: ping\ndata:\n\nevent: act'))
        c.enqueue(enc.encode('ivity\ndata: {"a":1}\n\ndata: x\ndata: y\n\n'))
        c.close()
      },
    })
    const events = []
    for await (const e of readServerEvents(body)) events.push(e)
    expect(events).toEqual([{ event: 'ping', data: '' }, { event: 'activity', data: '{"a":1}' }, { event: 'message', data: 'x\ny' }])
  })

  it('runs the command per activity event with the card context, one run per card at a time', async () => {
    const h = harness({ concurrency: 2, comment: 'failure' })
    await until(() => h.streams.length === 1)
    const s = h.streams[0]!
    s.send('ready')
    s.send('activity', { a: 'a1', b: B, card: 'c1', kind: 'moved', column: TODO })
    s.send('activity', { a: 'a1', b: B, card: 'c1', kind: 'moved', column: TODO })
    s.send('activity', { a: 'a2', b: B, card: 'c1', kind: 'commented', column: TODO })
    s.send('activity', { a: 'a3', b: B, card: 'c2', kind: 'created', column: TODO })
    await until(() => h.runs.length === 2)
    // c1 twice (a1, a2; the duplicate a1 dropped), but its second run waits for the first.
    expect(h.runs.map(r => [r.job.cardId, r.job.event])).toEqual([['c1', 'moved'], ['c2', 'created']])
    const first = h.runs[0]!
    expect(first.env).toMatchObject({ KANSO_BOARD_ID: B, KANSO_CARD_ID: 'c1', KANSO_EVENT: 'moved', KANSO_EVENT_SOURCE: 'activity', KANSO_ACTIVITY_ID: 'a1', KANSO_URL: 'https://k.test', KANSO_TOKEN: 'kb_x', KANSO_CARD_URL: `https://k.test/boards/${B}?card=c1` })
    const ctx = JSON.parse(first.stdin) as CardContext
    expect(ctx).toMatchObject({ event: { source: 'activity', kind: 'moved', activityId: 'a1' }, board: { id: B, name: 'Kanso' }, column: { id: TODO, title: 'To do' }, card: { id: 'c1', title: 'Card c1' }, detail })

    first.finish({ code: 3 })
    await until(() => h.runs.length === 3)
    expect(h.runs[2]!.job).toMatchObject({ cardId: 'c1', event: 'commented' })
    // Failure comment, sent with the runner's client id (so its own stream skips it).
    await until(() => h.requests.some(r => r.method === 'POST'))
    const post = h.requests.find(r => r.method === 'POST')!
    expect(post).toMatchObject({ url: 'https://k.test/api/cards/c1/comments', clientId: AGENT_CLIENT_ID })
    expect((post.body as { body: string }).body).toContain('failed with exit code 3')

    // Stopping waits for the runs in progress.
    h.stop()
    let stopped = false
    void h.done.then(() => { stopped = true })
    await new Promise(r => setTimeout(r, 20))
    expect(stopped).toBe(false)
    h.runs[1]!.finish()
    h.runs[2]!.finish()
    await h.done
    expect(h.requests.filter(r => r.method === 'POST')).toHaveLength(1)
  })

  it('handles unread notifications of its boards and marks them read afterwards', async () => {
    const inbox = [notification('n2', 'c2'), notification('n1', 'c1'), notification('n9', 'c9', 'other-board')]
    const h = harness({ notifications: true, activity: [], columnIds: [] }, inbox)
    await until(() => h.streams.length === 1)
    h.streams[0]!.send('ready')
    await until(() => h.runs.length === 1)
    // Oldest first; concurrency 1.
    expect(h.runs[0]!.job).toMatchObject({ cardId: 'c1', source: 'notification', notificationId: 'n1', event: 'commented' })
    expect(h.runs[0]!.env.KANSO_NOTIFICATION_ID).toBe('n1')
    expect(JSON.parse(h.runs[0]!.stdin).event.notification.activity.actorName).toBe('Bob')
    // A notifications event while n1 runs queues nothing twice.
    h.streams[0]!.send('notifications')
    await new Promise(r => setTimeout(r, 20))
    h.runs[0]!.finish({ code: 1 })
    await until(() => h.runs.length === 2)
    expect(h.runs[1]!.job.notificationId).toBe('n2')
    h.runs[1]!.finish()
    await until(() => inbox.filter(n => n.readAt).length === 2)
    expect(inbox.find(n => n.id === 'n9')!.readAt).toBeNull()
    h.stop()
    await h.done
    expect(h.runs).toHaveLength(2)
  })

  it('reconnects with backoff after the stream ends, and stops on a refused token', async () => {
    const h = harness()
    await until(() => h.streams.length === 1)
    h.streams[0]!.end()
    await until(() => h.streams.length === 2)
    expect(h.deps.sleep).toHaveBeenCalledWith(1000, expect.anything())
    h.stop()
    await h.done

    const fetch = vi.fn(async () => Response.json({ message: 'Invalid token' }, { status: 401 }))
    const deps: AgentDeps = {
      client: createClient({ url: 'https://k.test', token: 'kb_x' }, fetch as unknown as typeof globalThis.fetch),
      fetch: fetch as unknown as typeof globalThis.fetch,
      log: () => {}, sleep: async () => {}, signal: new AbortController().signal, exec: async () => ({ code: 0, signal: null, timedOut: false }),
    }
    await expect(runAgent({ url: 'https://k.test', token: 'kb_x', boardIds: [B], activity: ['moved'], columnIds: [], notifications: false, concurrency: 1, comment: 'never' }, deps))
      .rejects.toThrow('The token was refused (401: Invalid token)')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stops when a board is gone', async () => {
    const h = harness()
    await until(() => h.streams.length === 1)
    h.streams[0]!.send('gone', { b: B })
    await expect(h.done).rejects.toBeInstanceOf(BoardGoneError)
  })

  it('resolves columns by id or title and builds the claude prompt', () => {
    expect(splitList(' a, b,,a ')).toEqual(['a', 'b'])
    expect(resolveColumns(['to do', TODO.toUpperCase()], [board])).toEqual([TODO])
    expect(() => resolveColumns(['Doing'], [board])).toThrow('No column "Doing" on the given boards (Kanso: "To do", "Done").')
    const ctx = {
      event: { source: 'activity', kind: 'moved', activityId: 'a1', notificationId: null, notification: null },
      board: { id: B, name: 'Kanso', url: '' }, column: { id: TODO, title: 'To do' },
      card: { ...card('c1'), url: 'https://k.test/boards/b?card=c1' }, detail,
    } as unknown as CardContext
    const prompt = claudePrompt(ctx)
    expect(prompt).toContain('Card: Card c1 (id c1), in column "To do"')
    expect(prompt).toContain('Do what the card asks')
    expect(claudePrompt(ctx, 'Fix the bug.')).toMatch(/Fix the bug\.\n$/)
    expect(statusComment({ event: 'moved' } as Job, { code: 0, signal: null, timedOut: false }, 4)).toBe('kanso agent: the run for **moved** finished after 4 s.')
    expect(statusComment({ event: 'moved' } as Job, { code: null, signal: 'SIGTERM', timedOut: true }, 60)).toContain('stopped after the timeout')
  })
  it('follows the agent rules of its bot (rules mode)', async () => {
    const rule = (id: string, extra: Partial<AgentRule> = {}): AgentRule => ({
      id, name: `Rule ${id}`, botId: BOT, event: 'card_moved', columnId: TODO, tagId: null, instructions: `Do ${id}.`,
      moveColumnId: null, comment: 'never', settleSeconds: null, active: true, ...extra,
    })
    const act = (id: string, kind: string, actorId: string, data: Record<string, unknown> = {}) => ({ id, kind, actorId, actorName: null, data, createdAt: '' })
    const rules = [
      rule('r1', { moveColumnId: DONE, comment: 'always' }),
      rule('r2', { event: 'mentioned', columnId: null }),
      rule('r3', { botId: 'someone-else' }),
      rule('r4', { event: 'tag_added', columnId: null, tagId: BUG }),
    ]
    const details: Record<string, CardDetail> = {
      c1: { ...detail, activity: [act('a1', 'moved', 'u1'), act('a2', 'commented', 'u1', { mentions: [BOT] })] } as unknown as CardDetail,
      c2: { ...detail, activity: [act('a3', 'commented', 'u1', { mentions: [] }), act('a4', 'moved', BOT)] } as unknown as CardDetail,
      c3: { ...detail, activity: [act('a5', 'tagged', 'u1', { tag: 'bug' })] } as unknown as CardDetail,
    }
    const h = harness({ rulesFor: BOT, activity: [], columnIds: [], concurrency: 4 }, [], rules, details)
    await until(() => h.streams.length === 1)
    expect(h.requests[0]!.url).toContain('change=1')
    const s = h.streams[0]!
    s.send('ready')
    await until(() => h.requests.some(r => r.url.endsWith('/agent-rules')))
    s.send('activity', { a: 'a1', b: B, card: 'c1', kind: 'moved', column: TODO })
    s.send('activity', { a: 'a3', b: B, card: 'c2', kind: 'commented', column: TODO })
    s.send('activity', { a: 'a4', b: B, card: 'c2', kind: 'moved', column: TODO })
    s.send('activity', { a: 'a5', b: B, card: 'c3', kind: 'tagged', column: TODO })
    s.send('activity', { a: 'a6', b: B, card: 'c4', kind: 'moved', column: DONE })
    await until(() => h.runs.length === 2)
    await new Promise(r => setTimeout(r, 20))
    // a3: the bot was not mentioned; a4: the bot moved it itself; a6: another column.
    expect(h.runs.map(r => [r.job.cardId, r.job.rule?.id])).toEqual([['c1', 'r1'], ['c3', 'r4']])
    expect(h.runs[0]!.env).toMatchObject({ KANSO_RULE_ID: 'r1', KANSO_RULE_NAME: 'Rule r1' })
    expect(JSON.parse(h.runs[0]!.stdin).rule).toEqual({ id: 'r1', name: 'Rule r1', instructions: 'Do r1.' })

    // A successful run moves the card to the end of the rule's column and comments (rule's comment mode).
    h.runs[0]!.finish()
    await until(() => h.requests.some(r => r.url.endsWith('/comments')))
    const move = h.requests.find(r => r.url.endsWith('/move'))!
    expect(move).toMatchObject({ url: 'https://k.test/api/cards/c1/move', body: { columnId: DONE, aboveId: 'c4', belowId: null }, clientId: AGENT_CLIENT_ID })
    expect((h.requests.find(r => r.url.endsWith('/comments'))!.body as { body: string }).body).toContain('(agent rule "Rule r1")')
    // r4 has comment never.
    h.runs[1]!.finish({ code: 1 })

    // A board change reloads the rules: a mention now starts r2.
    h.agentRules.splice(0, h.agentRules.length, rule('r2', { event: 'mentioned', columnId: null }))
    const reads = h.requests.filter(r => r.url.endsWith('/agent-rules')).length
    s.send('change', { b: B, c: '' })
    await until(() => h.requests.filter(r => r.url.endsWith('/agent-rules')).length > reads)
    s.send('activity', { a: 'a2', b: B, card: 'c1', kind: 'commented', column: TODO })
    await until(() => h.runs.length === 3)
    expect(h.runs[2]!.job.rule?.id).toBe('r2')
    h.runs[2]!.finish()
    h.stop()
    await h.done
    expect(h.requests.filter(r => r.url.endsWith('/comments'))).toHaveLength(1)
  })

  it('waits for the card to stay unchanged before a rule runs (settle)', async () => {
    const act = (id: string, actorId: string, createdAt: string) => ({ id, kind: 'described', actorId, actorName: null, data: {}, createdAt })
    const rule: AgentRule = {
      id: 'r1', name: 'Rule r1', botId: BOT, event: 'card_moved', columnId: TODO, tagId: null, instructions: 'Do it.',
      moveColumnId: null, comment: 'never', settleSeconds: 30, active: true,
    }
    const c1 = { ...detail, activity: [act('a1', 'u1', '2026-01-01T00:00:00Z')] } as unknown as CardDetail
    const details: Record<string, CardDetail> = { c1 }
    let sleeps = 0
    let reloaded!: () => void
    const gate = new Promise<void>((r) => { reloaded = r })
    const h = harness({ rulesFor: BOT, activity: [], columnIds: [], concurrency: 4 }, [], [rule], details, async () => {
      sleeps++
      if (sleeps > 10) await gate
      // Someone edits the card during the first wait; the bot's own change during the second does not count.
      if (sleeps === 1) details.c1 = { ...c1, activity: [act('a2', 'u1', '2026-01-01T00:00:10Z'), ...c1.activity] } as unknown as CardDetail
      if (sleeps === 2) details.c1 = { ...details.c1!, activity: [act('a3', BOT, '2026-01-01T00:00:20Z'), ...details.c1!.activity] } as unknown as CardDetail
    })
    await until(() => h.streams.length === 1)
    const s = h.streams[0]!
    s.send('ready')
    await until(() => h.requests.some(r => r.url.endsWith('/agent-rules')))
    s.send('activity', { a: 'a1', b: B, card: 'c1', kind: 'moved', column: TODO })
    await until(() => h.runs.length === 1)
    expect(h.deps.sleep).toHaveBeenCalledTimes(2)
    expect(h.deps.sleep).toHaveBeenCalledWith(30_000, expect.anything())
    h.runs[0]!.finish()

    // A rule switched off during the wait does not run.
    sleeps = 10
    h.agentRules.splice(0, 1)
    const reads = h.requests.filter(r => r.url.endsWith('/agent-rules')).length
    s.send('activity', { a: 'a4', b: B, card: 'c2', kind: 'moved', column: TODO })
    s.send('change', { b: B, c: '' })
    await until(() => h.requests.filter(r => r.url.endsWith('/agent-rules')).length > reads)
    await new Promise(r => setTimeout(r, 20))
    reloaded()
    await new Promise(r => setTimeout(r, 20))
    h.stop()
    await h.done
    expect(h.runs).toHaveLength(1)
  })

  it('picks the settle time and marks card changes', () => {
    expect(agentRuleSettleDefaults).toEqual(sharedSettleDefaults)
    const r = { event: 'card_created', settleSeconds: null } as AgentRule
    expect(settleSeconds(r, null)).toBe(60)
    expect(settleSeconds({ ...r, event: 'mentioned' }, undefined)).toBe(0)
    expect(settleSeconds(r, 5)).toBe(5)
    expect(settleSeconds({ ...r, settleSeconds: 0 }, 5)).toBe(0)
    expect(settleSeconds(undefined, null)).toBe(0)
    expect(settleSeconds(undefined, 20)).toBe(20)
    const a = (id: string, actorId: string, createdAt: string) => ({ id, actorId, createdAt })
    const base = { activity: [a('a1', 'u', '2026-01-01T00:00:00Z')], checklists: [], attachments: [] } as unknown as CardDetail
    const m = changeMarker(base, BOT)
    expect(changeMarker({ ...base, activity: [a('a2', BOT, '2026-01-02T00:00:00Z'), ...base.activity] } as unknown as CardDetail, BOT)).toBe(m)
    expect(changeMarker({ ...base, activity: [a('a2', 'u', '2026-01-02T00:00:00Z'), ...base.activity] } as unknown as CardDetail, BOT)).not.toBe(m)
    expect(changeMarker({ ...base, checklists: [{ items: [{ id: 'i', text: 'x' }] }] } as unknown as CardDetail, BOT)).not.toBe(m)
  })

  it('matches rules to events', () => {
    const r = { id: 'r', name: 'R', botId: BOT, event: 'mentioned', columnId: null, tagId: null, instructions: 'x', moveColumnId: null, comment: 'never', settleSeconds: null, active: true } as AgentRule
    expect(rulesForEvent([r], BOT, 'mentioned', TODO)).toEqual([r])
    expect(rulesForEvent([r], BOT, 'moved', TODO)).toEqual([])
    expect(rulesForEvent([{ ...r, active: false }], BOT, 'commented', TODO)).toEqual([])
    const ctx = (activity: unknown[], extra: Record<string, unknown> = {}) => ({ card: card('c1', extra), column: { id: TODO, title: 'To do' }, detail: { ...detail, activity } }) as unknown as CardContext
    const assigned = { ...r, event: 'assigned' } as AgentRule
    expect(ruleSkipReason(assigned, BOT, ctx([{ id: 'a', actorId: 'u', data: { user_id: BOT } }]), [], 'a')).toBeNull()
    expect(ruleSkipReason(assigned, BOT, ctx([{ id: 'a', actorId: 'u', data: { user_id: 'u2' } }]), [], 'a')).toBe('someone else was assigned')
    // Activity no longer among the card's latest: falls back to the assignees.
    expect(ruleSkipReason(assigned, BOT, ctx([], { assigneeIds: [BOT] }), [], 'a')).toBeNull()
    expect(ruleSkipReason({ ...r, event: 'card_created', tagId: BUG } as AgentRule, BOT, ctx([]), [], 'a')).toBe('the card does not have the rule\'s tag')
    expect(ruleSkipReason({ ...r, event: 'card_created', columnId: DONE } as AgentRule, BOT, ctx([]), [], 'a')).toBe('the card is no longer in the rule\'s column')
    expect(streamQuery({ boardIds: [B], activity: [], columnIds: [], notifications: false, rulesFor: BOT }))
      .toBe(`boards=${B}&activity=created%2Cmoved%2Ctagged%2Cassigned%2Ccommented%2Cmentioned&change=1&clients=kanso-agent`)
    const prompt = claudePrompt({ ...ctx([]), event: { source: 'activity', kind: 'moved' }, board: { id: B, name: 'Kanso' }, rule: { id: 'r', name: 'Triage', instructions: 'Triage it.' } } as unknown as CardContext, 'ignored')
    expect(prompt).toContain('Agent rule: Triage')
    expect(prompt).toMatch(/Triage it\.\n$/)
  })
})
