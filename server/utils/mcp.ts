import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { priorities, type BoardDetail, type CardDetail } from '#shared/types/board'
import { CARD_TITLE_MAX } from '#shared/cards'

/**
 * The MCP server behind POST /api/mcp. Every tool is a call to an existing REST
 * route as the token's user (same Authorization header), so validation, the
 * token route allowlist and scope check, RLS, activity, notifications,
 * webhooks and live board updates all apply unchanged. No permission logic
 * here: a new tool wraps a route that tokens may already call.
 */

export interface McpCaller {
  /** Authorization header of the MCP request (a Bearer API token). */
  authorization: string
  /** Client IP, forwarded so per-IP rate limits see the agent and not the server. */
  ip: string
  /** Whether the token has the write scope; write tools are only listed then. */
  canWrite: boolean
}

type Query = Record<string, string | undefined>

const instructions = `Kanso is a kanban app. Typical flow: list_boards, then get_board for its columns, cards, tags,
members and fields (ids needed by the write tools), then get_card for one card's description, checklist, comments
and links. Use search to find cards by text across boards and my_work for cards assigned to or watched by you.
Everything runs as the token's user: you only see and change what they can. Dates are YYYY-MM-DD.`

const id = z.uuid()

/** A failure the agent should read, e.g. a lookup that came back empty. */
class ToolError extends Error {}

interface ApiError { statusCode?: number, statusMessage?: string, data?: { statusMessage?: string, message?: string, data?: unknown } }

export function createMcpServer(caller: McpCaller): McpServer {
  const server = new McpServer({ name: 'kanso', version: '1.0.0' }, { instructions })

  async function call<T>(path: string, init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT', body?: unknown, query?: Query } = {}): Promise<T> {
    return await $fetch<T>(path, {
      method: init.method ?? 'GET',
      body: init.body as Record<string, unknown> | undefined,
      query: init.query,
      headers: { 'authorization': caller.authorization, 'x-forwarded-for': caller.ip, 'x-client-id': 'mcp' },
    })
  }

  /** Runs a tool body; API errors become tool errors the agent can read and recover from. */
  async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
    try {
      const result = await fn()
      return { content: [{ type: 'text', text: result === undefined ? 'OK' : JSON.stringify(result) }] }
    }
    catch (err) {
      if (err instanceof ToolError) return { isError: true, content: [{ type: 'text', text: err.message }] }
      // ofetch errors of the inner API call: status and message (and zod issues) for the agent.
      const { statusCode, statusMessage, data } = err as ApiError
      if (!statusCode) throw err
      const message = data?.statusMessage ?? data?.message ?? statusMessage ?? 'Request failed'
      const details = data?.data ? ` ${JSON.stringify(data.data)}` : ''
      return { isError: true, content: [{ type: 'text', text: `${statusCode} ${message}${details}` }] }
    }
  }

  const read = { readOnlyHint: true, openWorldHint: false } as const
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const

  server.registerTool('list_boards', {
    description: 'Boards you can see, with your role (viewer, editor, owner) and whether they are archived.',
    annotations: read,
  }, () => run(async () => (await call<{ id: string, name: string, role: string, archivedAt: string | null, starred: boolean }[]>('/api/boards'))
    .map(b => ({ id: b.id, name: b.name, role: b.role, archived: b.archivedAt !== null, starred: b.starred }))))

  server.registerTool('get_board', {
    description: 'A board with its columns in order (cards in each, in order), tags, members, custom fields and card templates. The last column counts as done.',
    inputSchema: { boardId: id },
    annotations: read,
  }, ({ boardId }) => run(async () => boardForAgent(await call<BoardDetail>(`/api/boards/${boardId}`))))

  server.registerTool('get_card', {
    description: 'One card with description, checklist, comments, links, attachments and recent activity.',
    inputSchema: { boardId: id, cardId: id },
    annotations: read,
  }, ({ boardId, cardId }) => run(async () => {
    const [board, detail] = await Promise.all([call<BoardDetail>(`/api/boards/${boardId}`), call<CardDetail>(`/api/cards/${cardId}`)])
    const card = board.cards.find(c => c.id === cardId)
    if (!card) throw new ToolError('404 Card not found on this board (archived cards and templates are not shown)')
    return cardForAgent(board, card, detail)
  }))

  server.registerTool('search', {
    description: 'Full-text search (prefix match on words) over card titles, descriptions, comments, board names and column titles on every board you can see.',
    inputSchema: { query: z.string().min(1).max(200), includeArchived: z.boolean().optional() },
    annotations: read,
  }, ({ query, includeArchived }) => run(() => call('/api/search', { query: { q: query, archived: includeArchived ? '1' : '0' } })))

  server.registerTool('my_work', {
    description: 'Open cards on all boards that are assigned to you or that you watch, soonest due first, with assigned/watching/done flags.',
    annotations: read,
  }, () => run(() => call('/api/my-work')))

  server.registerTool('list_notifications', {
    description: 'Your notifications (newest first, with unread count) and your cards due by tomorrow.',
    annotations: read,
  }, () => run(() => call('/api/notifications')))

  if (!caller.canWrite) return server

  server.registerTool('create_card', {
    description: 'Add a card at the end of a column. Column rules may add tags, assignees or a due date. Pass templateId (from get_board) to copy a card template; title then overrides its title.',
    inputSchema: {
      boardId: id,
      columnId: id,
      title: z.string().min(1).max(CARD_TITLE_MAX).optional(),
      description: z.string().max(10_000).optional().describe('Markdown'),
      templateId: id.optional(),
    },
    annotations: write,
  }, ({ boardId, ...body }) => run(() => call(`/api/boards/${boardId}/cards`, { method: 'POST', body })))

  server.registerTool('update_card', {
    description: 'Change a card. Only the given fields change; tagIds and assigneeIds replace the whole set (ids from get_board). null clears a value. archived: true archives the card.',
    inputSchema: {
      cardId: id,
      title: z.string().min(1).max(CARD_TITLE_MAX).optional(),
      description: z.string().max(10_000).optional().describe('Markdown'),
      startDate: z.iso.date().nullable().optional(),
      dueDate: z.iso.date().nullable().optional(),
      priority: z.enum(priorities).nullable().optional(),
      estimate: z.number().min(0).nullable().optional().describe('Story points'),
      tagIds: z.array(id).optional(),
      assigneeIds: z.array(id).optional(),
      archived: z.boolean().optional(),
    },
    annotations: write,
  }, ({ cardId, ...body }) => run(() => call(`/api/cards/${cardId}`, { method: 'PATCH', body })))

  server.registerTool('move_card', {
    description: 'Move a card to a column of the same board. Without aboveId/belowId it goes to the end; otherwise give the neighbouring card ids in the target column after the move. Column rules run.',
    inputSchema: { cardId: id, columnId: id, aboveId: id.nullable().optional(), belowId: id.nullable().optional() },
    annotations: write,
  }, ({ cardId, columnId, aboveId, belowId }) => run(() =>
    call(`/api/cards/${cardId}/move`, { method: 'POST', body: { columnId, aboveId: aboveId ?? null, belowId: belowId ?? null } })))

  server.registerTool('bulk_update_cards', {
    description: 'Apply one change to up to 200 cards of a board, all or none. columnId moves them to the end of that column; tags and assignees are added or removed, not replaced.',
    inputSchema: {
      boardId: id,
      cardIds: z.array(id).min(1).max(200),
      columnId: id.optional(),
      archived: z.boolean().optional(),
      priority: z.enum(priorities).nullable().optional(),
      dueDate: z.iso.date().nullable().optional(),
      addTagIds: z.array(id).optional(),
      removeTagIds: z.array(id).optional(),
      addAssigneeIds: z.array(id).optional(),
      removeAssigneeIds: z.array(id).optional(),
    },
    annotations: write,
  }, ({ boardId, ...body }) => run(() => call(`/api/boards/${boardId}/cards/bulk`, { method: 'POST', body })))

  server.registerTool('add_comment', {
    description: 'Comment on a card (Markdown). Assignees and watchers are notified.',
    inputSchema: { cardId: id, body: z.string().min(1).max(10_000) },
    annotations: write,
  }, ({ cardId, body }) => run(() => call(`/api/cards/${cardId}/comments`, { method: 'POST', body: { body } })))

  server.registerTool('add_checklist_item', {
    description: 'Add an item at the end of a card\'s checklist.',
    inputSchema: { cardId: id, text: z.string().min(1).max(500) },
    annotations: write,
  }, ({ cardId, text }) => run(() => call(`/api/cards/${cardId}/checklist`, { method: 'POST', body: { text } })))

  server.registerTool('update_checklist_item', {
    description: 'Tick or untick a checklist item, or change its text (item ids from get_card).',
    inputSchema: { itemId: id, done: z.boolean().optional(), text: z.string().min(1).max(500).optional() },
    annotations: write,
  }, ({ itemId, ...body }) => run(() => call(`/api/checklist-items/${itemId}`, { method: 'PATCH', body })))

  return server
}
