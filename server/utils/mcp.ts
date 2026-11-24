import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { boardAutomationKinds, boardRuleEvents, cardLinkKinds, priorities, scheduledCardActionKinds, type BoardDetail, type CardDetail } from '#shared/types/board'
import { boardAccents } from '#shared/boardAccents'
import { CARD_TITLE_MAX } from '#shared/cards'
import { COLUMN_DESCRIPTION_MAX } from '#shared/columns'

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
Board structure: columns, card tags (labels on cards), column tags (named sets of columns that filter the board view)
and time-based automations; get_board lists them with their ids and colours.
Everything runs as the token's user: you only see and change what they can. Dates are YYYY-MM-DD.`

const id = z.uuid()
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('#rrggbb')
/** Default for a new card tag when the agent picks no colour (slate). */
const DEFAULT_TAG_COLOR = '#64748b'

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
    description: 'Boards you can see, with your role (viewer, commenter, editor, owner) and whether they are archived.',
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

  server.registerTool('mark_notifications_read', {
    description: 'Mark notifications read once handled (ids from list_notifications), so the next poll shows only new ones. Without ids, marks all read.',
    inputSchema: { notificationIds: z.array(id).min(1).max(50).optional() },
    annotations: { ...write, idempotentHint: true },
  }, ({ notificationIds }) => run(async () => {
    if (!notificationIds) return await call('/api/notifications/read-all', { method: 'POST' })
    for (const n of notificationIds) await call(`/api/notifications/${n}`, { method: 'PATCH', body: { read: true } })
    return { updated: notificationIds.length }
  }))

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
      skipAutomations: z.boolean().optional().describe('true: board and column automations leave the card alone (its own still run)'),
      snoozedUntil: z.iso.date().nullable().optional().describe('Hide the card from the board until this date (it comes back that day, watchers are notified); null brings it back now'),
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

  server.registerTool('link_cards', {
    description: 'Link two cards of the same board. kind "blocks": fromCardId blocks toCardId (toCardId is blocked by fromCardId until fromCardId reaches the last column); "relates" and "duplicates" (fromCardId duplicates toCardId) likewise. Blocking cycles and duplicate links are refused (409). Existing links are in get_card.',
    inputSchema: { fromCardId: id, toCardId: id, kind: z.enum(cardLinkKinds) },
    annotations: write,
  }, ({ fromCardId, toCardId, kind }) => run(() => call(`/api/cards/${fromCardId}/links`, { method: 'POST', body: { toCardId, kind } })))

  server.registerTool('create_checklist', {
    description: 'Add an empty named checklist at the end of a card\'s checklists. Returns its id for add_checklist_item.',
    inputSchema: { cardId: id, name: z.string().min(1).max(100) },
    annotations: write,
  }, ({ cardId, name }) => run(() => call(`/api/cards/${cardId}/checklists`, { method: 'POST', body: { name } })))

  server.registerTool('add_checklist_item', {
    description: 'Add an item at the end of one of a card\'s checklists (checklistId from get_card or create_checklist); without checklistId, the card\'s first checklist (created as "Checklist" when it has none). Optionally with an assignee (a board member, user id from get_board) and a due date.',
    inputSchema: { cardId: id, text: z.string().min(1).max(500), checklistId: id.optional(), assigneeId: id.optional(), dueDate: z.iso.date().optional() },
    annotations: write,
  }, ({ cardId, ...body }) => run(() => call(`/api/cards/${cardId}/checklist`, { method: 'POST', body })))

  server.registerTool('update_checklist_item', {
    description: 'Tick or untick a checklist item, change its text, or set its assignee (a board member, user id from get_board) or due date; null clears them (item ids from get_card). The assignee is notified.',
    inputSchema: {
      itemId: id, done: z.boolean().optional(), text: z.string().min(1).max(500).optional(),
      assigneeId: id.nullable().optional(), dueDate: z.iso.date().nullable().optional(),
    },
    annotations: write,
  }, ({ itemId, ...body }) => run(() => call(`/api/checklist-items/${itemId}`, { method: 'PATCH', body })))

  server.registerTool('create_column', {
    description: 'Add a column at the right end of a board. columnTagId also puts it in that column tag.',
    inputSchema: { boardId: id, title: z.string().min(1).max(100), columnTagId: id.optional() },
    annotations: write,
  }, ({ boardId, title, columnTagId }) => run(() => call(`/api/boards/${boardId}/columns`, { method: 'POST', body: { title, groupId: columnTagId } })))

  server.registerTool('update_column', {
    description: 'Rename a column, set its description (Markdown, null or blank clears), heading colour or WIP limit (null clears), or move it: aboveId/belowId are the neighbouring column ids after the move (left/right; null = start/end).',
    inputSchema: {
      columnId: id,
      title: z.string().min(1).max(100).optional(),
      description: z.string().max(COLUMN_DESCRIPTION_MAX).nullable().optional(),
      color: color.nullable().optional(),
      wipLimit: z.number().int().min(1).max(999).nullable().optional(),
      aboveId: id.nullable().optional(),
      belowId: id.nullable().optional(),
    },
    annotations: write,
  }, ({ columnId, ...body }) => run(() => call(`/api/columns/${columnId}`, { method: 'PATCH', body })))

  server.registerTool('create_tag', {
    description: 'Add a card tag (label) to a board. Put it on cards with update_card tagIds or bulk_update_cards addTagIds.',
    inputSchema: { boardId: id, name: z.string().min(1).max(50), color: color.optional() },
    annotations: write,
  }, ({ boardId, name, color }) => run(() => call(`/api/boards/${boardId}/tags`, { method: 'POST', body: { name, color: color ?? DEFAULT_TAG_COLOR } })))

  server.registerTool('update_tag', {
    description: 'Rename a card tag or change its colour.',
    inputSchema: { tagId: id, name: z.string().min(1).max(50).optional(), color: color.optional() },
    annotations: write,
  }, ({ tagId, ...body }) => run(() => call(`/api/tags/${tagId}`, { method: 'PATCH', body })))

  server.registerTool('create_column_tag', {
    description: 'Add a column tag: a named set of columns (a column can be in several) that people pick to show only those columns. Name unique per board.',
    inputSchema: { boardId: id, name: z.string().min(1).max(50), color: color.nullable().optional(), columnIds: z.array(id).max(200).optional() },
    annotations: write,
  }, ({ boardId, ...body }) => run(() => call(`/api/boards/${boardId}/column-groups`, { method: 'POST', body })))

  server.registerTool('update_column_tag', {
    description: 'Rename a column tag, change its colour (null = default), or set its columns: columnIds replaces the whole set (current ids from get_board columnTags).',
    inputSchema: { columnTagId: id, name: z.string().min(1).max(50).optional(), color: color.nullable().optional(), columnIds: z.array(id).max(200).optional() },
    annotations: write,
  }, ({ columnTagId, ...body }) => run(() => call(`/api/column-groups/${columnTagId}`, { method: 'PATCH', body })))

  server.registerTool('create_assignee_group', {
    description: 'Add an assignee group: a named set of board members (user ids from get_board members). Assigning a group means adding its members as assignees (update_card assigneeIds, bulk_update_cards addAssigneeIds). Name unique per board.',
    inputSchema: { boardId: id, name: z.string().min(1).max(50), userIds: z.array(id).max(200).optional() },
    annotations: write,
  }, ({ boardId, ...body }) => run(() => call(`/api/boards/${boardId}/assignee-groups`, { method: 'POST', body })))

  server.registerTool('update_assignee_group', {
    description: 'Rename an assignee group or set its members: userIds replaces the whole set (current ids from get_board assigneeGroups). Cards keep their assignees.',
    inputSchema: { assigneeGroupId: id, name: z.string().min(1).max(50).optional(), userIds: z.array(id).max(200).optional() },
    annotations: write,
  }, ({ assigneeGroupId, ...body }) => run(() => call(`/api/assignee-groups/${assigneeGroupId}`, { method: 'PATCH', body })))

  server.registerTool('create_automation', {
    description: 'Add a time-based automation (runs hourly on open cards: not archived, not in the last column; '
      + 'with columnId only on the cards in that column, the last column included; with cardId only on that card, '
      + 'also when it skips automations). '
      + 'archive_done: archive cards in the last column (or columnId) for `days` days. tag_stale: add tagId to cards without activity for `days` days. '
      + 'notify_stale: notify assignees and watchers of cards without activity for `days` days. '
      + 'raise_priority: set `priority` on cards due within `days` days (0 = today) or overdue. '
      + 'move_card: move cards that have been in columnId (or cardId\'s current column) for `days` days to the end of targetColumnId '
      + '(column rules run; one per column or card). '
      + 'days is 1-365 (raise_priority 0-365).',
    inputSchema: {
      boardId: id,
      kind: z.enum(boardAutomationKinds),
      days: z.number().int().min(0).max(365),
      tagId: id.optional().describe('tag_stale only'),
      priority: z.enum(priorities).optional().describe('raise_priority only'),
      columnId: id.optional().describe('Limit to the cards in this column; move_card needs it or cardId'),
      cardId: id.optional().describe('Limit to this card (not with columnId)'),
      targetColumnId: id.optional().describe('move_card only: where the cards go'),
    },
    annotations: write,
  }, ({ boardId, ...body }) => run(() => call(`/api/boards/${boardId}/automations`, { method: 'POST', body })))

  server.registerTool('update_automation', {
    description: 'Change an automation\'s days or turn it on or off (active). Kind, tag, priority and columns are fixed.',
    inputSchema: { automationId: id, days: z.number().int().min(0).max(365).optional(), active: z.boolean().optional() },
    annotations: write,
  }, ({ automationId, ...body }) => run(() => call(`/api/automations/${automationId}`, { method: 'PATCH', body })))

  const ruleShape = {
    event: z.enum(boardRuleEvents).describe('What triggers the rule'),
    eventTagId: id.nullable().optional().describe('tag_added only: just this tag (default any)'),
    eventUserId: id.nullable().optional().describe('assigned only: just this person (default anyone)'),
    conditions: z.object({
      tagId: id.nullable().optional().describe('The card has this tag'),
      priority: z.enum(priorities).nullable().optional(),
      columnId: id.nullable().optional().describe('The card is in this column'),
      assigneeId: id.nullable().optional().describe('This person is assigned'),
    }).optional().describe('All given conditions must hold'),
    actions: z.object({
      moveColumnId: id.nullable().optional().describe('Move to the end of this column (column rules run)'),
      addTagId: id.nullable().optional(),
      removeTagId: id.nullable().optional(),
      assignUserId: id.nullable().optional().describe('A board member'),
      priority: z.enum(priorities).nullable().optional(),
      dueDays: z.number().int().min(0).max(365).nullable().optional().describe('Due date = today + dueDays'),
      archive: z.boolean().optional(),
    }).describe('At least one'),
  }
  const ruleHelp = 'Events: card_created, card_moved, tag_added, assigned, due_set, checklist_completed (every item done), commented. '
    + 'Rules run when the triggering change is saved, without an actor; their own changes trigger no rules.'

  server.registerTool('create_rule', {
    description: 'Add an event-triggered rule: when <event> and <conditions>, do <actions>. ' + ruleHelp,
    inputSchema: { boardId: id, ...ruleShape },
    annotations: write,
  }, ({ boardId, ...body }) => run(() => call(`/api/boards/${boardId}/rules`, { method: 'POST', body })))

  server.registerTool('update_rule', {
    description: 'Replace a rule\'s event, conditions and actions (omitted ones are cleared), or only turn it on or off (pass just active). ' + ruleHelp,
    inputSchema: { ruleId: id, active: z.boolean().optional(), ...ruleShape, event: ruleShape.event.optional(), actions: ruleShape.actions.optional() },
    annotations: write,
  }, ({ ruleId, ...body }) => run(() => call(`/api/board-rules/${ruleId}`, { method: 'PATCH', body })))

  server.registerTool('schedule_card_action', {
    description: 'Schedule a one-shot action on a card for a date (runs with the hourly automations, then disappears). '
      + 'move: to the end of targetColumnId (column rules run). archive. priority: set `priority`. '
      + 'remind: notify assignees and watchers, with an optional note. get_board lists scheduled actions as scheduledActions.',
    inputSchema: {
      cardId: id,
      kind: z.enum(scheduledCardActionKinds),
      runOn: z.iso.date().describe('YYYY-MM-DD'),
      targetColumnId: id.optional().describe('move only'),
      priority: z.enum(priorities).optional().describe('priority only'),
      note: z.string().max(500).optional().describe('remind only'),
    },
    annotations: write,
  }, ({ cardId, ...body }) => run(() => call(`/api/cards/${cardId}/scheduled-actions`, { method: 'POST', body })))

  server.registerTool('set_board_accent', {
    description: 'Set the board\'s accent colour (replaces the app\'s primary colour on that board), or null for the default. Board owners only.',
    inputSchema: { boardId: id, accent: z.enum(boardAccents).nullable() },
    annotations: write,
  }, ({ boardId, accent }) => run(() => call(`/api/boards/${boardId}/accent`, { method: 'PUT', body: { accent } })))

  return server
}
