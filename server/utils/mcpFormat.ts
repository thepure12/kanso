import type { BoardDetail, Card, CardDetail, FieldValue } from '#shared/types/board'

/**
 * Compact views of API responses for MCP tools: names instead of ids where an
 * agent needs to read them, ids kept where it needs to act, and display-only
 * data (colours, backgrounds, positions, rules) left out to save context.
 */

/** Activity entries returned per card; the dialog's full history is not needed by agents. */
const ACTIVITY_LIMIT = 20

function fieldValues(board: BoardDetail, values: Record<string, FieldValue>) {
  const out: Record<string, FieldValue> = {}
  for (const f of board.fields) {
    const v = values[f.id]
    if (v === undefined) continue
    out[f.name] = f.kind === 'select' ? (f.options.find(o => o.id === v)?.label ?? v) : v
  }
  return out
}

/** Cards with a 'blocks' link from a card still open (on the board and not in the last column), as in the UI. */
function blockedIds(board: BoardDetail): Set<string> {
  const done = board.columns.at(-1)?.id
  const columnOf = new Map(board.cards.map(c => [c.id, c.columnId]))
  const open = (id: string) => columnOf.has(id) && columnOf.get(id) !== done
  return new Set(board.cards.filter(c => c.blockerIds.some(open)).map(c => c.id))
}

function cardSummary(board: BoardDetail, card: Card, blocked: Set<string>) {
  const tagName = new Map(board.tags.map(t => [t.id, t.name]))
  const personName = new Map(board.members.map(m => [m.userId, m.name]))
  return {
    id: card.id,
    title: card.title,
    columnId: card.columnId,
    tags: card.tagIds.map(id => tagName.get(id) ?? id),
    assignees: card.assigneeIds.map(id => personName.get(id) ?? id),
    startDate: card.startDate,
    dueDate: card.dueDate,
    priority: card.priority,
    estimate: card.estimate,
    checklist: card.checklist.total ? card.checklist : undefined,
    comments: card.commentCount || undefined,
    blocked: blocked.has(card.id) || undefined,
    fields: Object.keys(card.fields).length ? fieldValues(board, card.fields) : undefined,
  }
}

export function boardForAgent(board: BoardDetail) {
  const blocked = blockedIds(board)
  return {
    id: board.id,
    name: board.name,
    yourRole: board.role,
    archived: board.archivedAt !== null,
    team: board.team?.name ?? null,
    columns: board.columns.map(c => ({
      id: c.id,
      title: c.title,
      wipLimit: c.wipLimit ?? undefined,
      cards: board.cards.filter(card => card.columnId === c.id).map(card => cardSummary(board, card, blocked)),
    })),
    tags: board.tags.map(t => ({ id: t.id, name: t.name })),
    members: board.members.map(m => ({ userId: m.userId, name: m.name, email: m.email, role: m.role })),
    fields: board.fields.map(f => ({ id: f.id, name: f.name, kind: f.kind, options: f.kind === 'select' ? f.options.map(o => o.label) : undefined })),
    templates: board.templates.map(t => ({ id: t.id, title: t.title })),
  }
}

export function cardForAgent(board: BoardDetail, card: Card, detail: CardDetail) {
  const column = board.columns.find(c => c.id === card.columnId)
  return {
    ...cardSummary(board, card, blockedIds(board)),
    boardId: board.id,
    column: column?.title,
    description: card.description,
    checklist: detail.checklist.map(i => ({ id: i.id, text: i.text, done: i.done })),
    comments: detail.comments.map(c => ({ id: c.id, author: c.authorName ?? c.importedAuthor, body: c.body, createdAt: c.createdAt })),
    links: detail.links.map(l => ({ id: l.id, kind: l.kind, direction: l.direction, card: { id: l.card.id, title: l.card.title, column: l.card.columnTitle } })),
    attachments: detail.attachments.map(a => ({ id: a.id, name: a.name, size: a.size })),
    timeMinutes: detail.timeTotal,
    watchers: detail.watchers.map(w => w.name),
    recentActivity: detail.activity.slice(0, ACTIVITY_LIMIT).map(a => ({ kind: a.kind, actor: a.actorName, data: a.data, at: a.createdAt })),
  }
}
