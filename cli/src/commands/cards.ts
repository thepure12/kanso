import type { ArchivedCard, BoardDetail, Card, CardDetail, CardPatch, Comment } from '../../../shared/types/board.ts'
import { UsageError } from '../io.ts'
import { fields, json, table } from '../output.ts'
import { cardId, findCard, findColumn, findMember, findTag, isUuid, loadBoard, pick } from '../resolve.ts'
import { boardOrder, cardView, connect, formatTime, listOption, meId, parseDate, parsePriority, positionals, shortId, stringOption } from './common.ts'
import type { Command } from './types.ts'

const refsHelp = 'A board is its id or name; columns and card tags are given by name, people by email, name or "me"; a card by its id, the first 8 characters of it (as listed) or its title. A name that fits several is refused with the matches listed.'

function cardLine(board: BoardDetail, card: Card) {
  const v = cardView(board, card)
  return [shortId(v.id), v.title, v.column, v.dueDate, v.priority, v.tags.map(t => t.name).join(', '), v.assignees.map(a => a.name).join(', ')]
}
const cardHeaders = ['ID', 'TITLE', 'COLUMN', 'DUE', 'PRIORITY', 'TAGS', 'ASSIGNEES']

/** Prints the card as changed by the server (rules may have added tags, assignees or a due date). */
function printCard(ctx: Parameters<Command['run']>[0], board: BoardDetail, card: Card, verb: string) {
  const view = cardView(board, card)
  ctx.io.stdout(ctx.json ? json(view) : `${verb} ${shortId(card.id)} "${card.title}" in ${view.column ?? '?'}.\n`)
}

export const cardsLs: Command = {
  name: 'cards ls',
  summary: 'List a board\'s cards, optionally filtered',
  usage: 'cards ls <board> [--column <name>] [--tag <name>] [--assignee <email|name|me>]',
  options: {
    column: { type: 'string', value: '<name>', description: 'Only cards in this column' },
    tag: { type: 'string', value: '<name>', multiple: true, description: 'Only cards with this card tag (repeat for all of several)' },
    assignee: { type: 'string', value: '<who>', description: 'Only cards assigned to this person (email, name or "me")' },
  },
  details: `Archived cards and templates are not listed. ${refsHelp}`,
  async run(ctx) {
    const [ref] = positionals(ctx, '<board>')
    const client = await connect(ctx)
    const board = await loadBoard(client, ref!)
    const column = stringOption(ctx, 'column')
    const columnId = column === undefined ? undefined : findColumn(board, column).id
    const tagIds = listOption(ctx, 'tag').map(t => findTag(board, t).id)
    const who = stringOption(ctx, 'assignee')
    const assigneeId = who === undefined ? undefined : findMember(board, who, who.toLowerCase() === 'me' ? await meId(client) : undefined).userId
    const cards = boardOrder(board).filter(c =>
      (!columnId || c.columnId === columnId)
      && tagIds.every(t => c.tagIds.includes(t))
      && (!assigneeId || c.assigneeIds.includes(assigneeId)))
    if (ctx.json) {
      ctx.io.stdout(json(cards.map(c => cardView(board, c))))
      return
    }
    ctx.io.stdout(cards.length ? table(cardHeaders, cards.map(c => cardLine(board, c))) : 'No cards.\n')
  },
}

export const cardShow: Command = {
  name: 'card show',
  summary: 'Show a card with its description, checklists, comments and links',
  usage: 'card show <board> <card>',
  details: refsHelp,
  async run(ctx) {
    const [boardRef, ref] = positionals(ctx, '<board>', '<card>')
    const client = await connect(ctx)
    const board = await loadBoard(client, boardRef!)
    const card = findCard(board, ref!)
    const detail = await client.get<CardDetail>(`/api/cards/${card.id}`)
    const view = {
      ...cardView(board, card),
      boardId: board.id,
      board: board.name,
      description: card.description,
      checklists: detail.checklists.map(l => ({ id: l.id, name: l.name, items: l.items.map(i => ({ id: i.id, text: i.text, done: i.done })) })),
      comments: detail.comments.map(c => ({ id: c.id, author: c.authorName ?? c.importedAuthor, body: c.body, createdAt: c.createdAt })),
      links: detail.links.map(l => ({ id: l.id, kind: l.kind, direction: l.direction, card: { id: l.card.id, title: l.card.title, column: l.card.columnTitle } })),
      watching: detail.watching,
    }
    if (ctx.json) {
      ctx.io.stdout(json(view))
      return
    }
    ctx.io.stdout(fields([
      ['Card', view.title],
      ['Id', view.id],
      ['Board', board.name],
      ['Column', view.column],
      ['Tags', view.tags.map(t => t.name).join(', ')],
      ['Assignees', view.assignees.map(a => a.name).join(', ')],
      ['Start', view.startDate],
      ['Due', view.dueDate],
      ['Priority', view.priority],
      ['Estimate', view.estimate],
    ]))
    if (view.description.trim()) ctx.io.stdout(`\n${view.description.trimEnd()}\n`)
    for (const l of view.checklists) {
      ctx.io.stdout(`\n${l.name} (${l.items.filter(i => i.done).length}/${l.items.length}):\n${l.items.map(i => `  [${i.done ? 'x' : ' '}] ${i.text}`).join('\n')}${l.items.length ? '\n' : ''}`)
    }
    if (view.links.length) {
      ctx.io.stdout(`\nLinks:\n${view.links.map(l => `  ${l.direction === 'in' ? `${l.kind} (from)` : l.kind} ${shortId(l.card.id)} "${l.card.title}" (${l.card.column})`).join('\n')}\n`)
    }
    if (view.comments.length) {
      ctx.io.stdout(`\nComments:\n${view.comments.map(c => `  ${c.author ?? '?'}, ${formatTime(c.createdAt)}:\n${c.body.trimEnd().split('\n').map(line => `    ${line}`).join('\n')}`).join('\n')}\n`)
    }
  },
}

export const cardAdd: Command = {
  name: 'card add',
  summary: 'Add a card at the end of a column',
  usage: 'card add <board> <column> <title> [--description <text>]',
  options: {
    description: { type: 'string', value: '<text>', description: 'Description (Markdown)' },
  },
  details: `Column rules may add card tags, assignees or a due date. ${refsHelp}`,
  async run(ctx) {
    const [boardRef, columnRef, title] = positionals(ctx, '<board>', '<column>', '<title>')
    const client = await connect(ctx)
    const board = await loadBoard(client, boardRef!)
    const column = findColumn(board, columnRef!)
    const description = stringOption(ctx, 'description')
    const card = await client.post<Card>(`/api/boards/${board.id}/cards`, { columnId: column.id, title, ...(description !== undefined && { description }) })
    printCard(ctx, board, card, 'Added')
  },
}

export const cardMv: Command = {
  name: 'card mv',
  summary: 'Move a card to the end (or top) of a column',
  usage: 'card mv <board> <card> <column> [--top]',
  options: {
    top: { type: 'boolean', description: 'Put it at the top of the column instead of the end' },
  },
  details: `Column rules of the new column run. ${refsHelp}`,
  async run(ctx) {
    const [boardRef, ref, columnRef] = positionals(ctx, '<board>', '<card>', '<column>')
    const client = await connect(ctx)
    const board = await loadBoard(client, boardRef!)
    const id = findCard(board, ref!).id
    const column = findColumn(board, columnRef!)
    const first = ctx.values.top ? boardOrder(board).find(c => c.columnId === column.id && c.id !== id) : undefined
    const card = await client.post<Card>(`/api/cards/${id}/move`, { columnId: column.id, aboveId: null, belowId: first?.id ?? null })
    printCard(ctx, board, card, 'Moved')
  },
}

export const cardEdit: Command = {
  name: 'card edit',
  summary: 'Change a card\'s title, description, dates, priority, card tags or assignees',
  usage: 'card edit <board> <card> [options]',
  options: {
    'title': { type: 'string', value: '<text>', description: 'New title' },
    'description': { type: 'string', value: '<text>', description: 'New description (Markdown)' },
    'due': { type: 'string', value: '<date>', description: 'Due date YYYY-MM-DD, or none' },
    'start': { type: 'string', value: '<date>', description: 'Start date YYYY-MM-DD, or none' },
    'priority': { type: 'string', value: '<p>', description: 'urgent, high, medium, low or none' },
    'add-tag': { type: 'string', value: '<name>', multiple: true, description: 'Add a card tag (repeatable)' },
    'remove-tag': { type: 'string', value: '<name>', multiple: true, description: 'Remove a card tag (repeatable)' },
    'clear-tags': { type: 'boolean', description: 'Remove every card tag first' },
    'assign': { type: 'string', value: '<who>', multiple: true, description: 'Add an assignee: email, name or "me" (repeatable)' },
    'unassign': { type: 'string', value: '<who>', multiple: true, description: 'Remove an assignee (repeatable)' },
    'clear-assignees': { type: 'boolean', description: 'Remove every assignee first' },
  },
  details: refsHelp,
  async run(ctx) {
    const [boardRef, ref] = positionals(ctx, '<board>', '<card>')
    const client = await connect(ctx)
    const board = await loadBoard(client, boardRef!)
    const card = findCard(board, ref!)
    const patch: CardPatch = {}
    const title = stringOption(ctx, 'title')
    if (title !== undefined) patch.title = title
    const description = stringOption(ctx, 'description')
    if (description !== undefined) patch.description = description
    const due = stringOption(ctx, 'due')
    if (due !== undefined) patch.dueDate = parseDate(due, 'due')
    const start = stringOption(ctx, 'start')
    if (start !== undefined) patch.startDate = parseDate(start, 'start')
    const priority = stringOption(ctx, 'priority')
    if (priority !== undefined) patch.priority = parsePriority(priority)

    const addTags = listOption(ctx, 'add-tag').map(t => findTag(board, t).id)
    const removeTags = listOption(ctx, 'remove-tag').map(t => findTag(board, t).id)
    if (ctx.values['clear-tags'] || addTags.length || removeTags.length) {
      const base = ctx.values['clear-tags'] ? [] : card.tagIds
      patch.tagIds = [...new Set([...base, ...addTags])].filter(t => !removeTags.includes(t))
    }
    const assign = listOption(ctx, 'assign')
    const unassign = listOption(ctx, 'unassign')
    if (ctx.values['clear-assignees'] || assign.length || unassign.length) {
      const me = [...assign, ...unassign].some(w => w.toLowerCase() === 'me') ? await meId(client) : undefined
      const add = assign.map(w => findMember(board, w, me).userId)
      const remove = unassign.map(w => findMember(board, w, me).userId)
      const base = ctx.values['clear-assignees'] ? [] : card.assigneeIds
      patch.assigneeIds = [...new Set([...base, ...add])].filter(u => !remove.includes(u))
    }
    if (!Object.keys(patch).length) throw new UsageError('Nothing to change. Run "kanso card edit --help" for the options.')
    const updated = await client.patch<Card>(`/api/cards/${card.id}`, patch)
    printCard(ctx, board, updated, 'Updated')
  },
}

export const cardArchive: Command = {
  name: 'card archive',
  summary: 'Archive a card (or bring it back with --restore)',
  usage: 'card archive <board> <card> [--restore]',
  options: {
    restore: { type: 'boolean', description: 'Unarchive it (the card is looked up among the archived cards)' },
  },
  details: refsHelp,
  async run(ctx) {
    const [boardRef, ref] = positionals(ctx, '<board>', '<card>')
    const client = await connect(ctx)
    const board = await loadBoard(client, boardRef!)
    const restore = ctx.values.restore === true
    // Archived cards are not on the board: look them up in its archived list.
    const id = restore
      ? isUuid(ref!) ? ref! : pick('archived card', ref!, await client.get<ArchivedCard[]>(`/api/boards/${board.id}/archived`), c => c.id, c => [c.title]).id
      : cardId(board, ref!)
    const card = await client.patch<Card>(`/api/cards/${id}`, { archived: !restore })
    printCard(ctx, board, card, restore ? 'Restored' : 'Archived')
  },
}

export const commentAdd: Command = {
  name: 'comment add',
  summary: 'Comment on a card (Markdown)',
  usage: 'comment add <board> <card> <text>',
  details: `Assignees and watchers are notified. ${refsHelp}`,
  async run(ctx) {
    const [boardRef, ref, text] = positionals(ctx, '<board>', '<card>', '<text>')
    const client = await connect(ctx)
    const board = await loadBoard(client, boardRef!)
    const card = findCard(board, ref!)
    const comment = await client.post<Comment>(`/api/cards/${card.id}/comments`, { body: text })
    if (ctx.json) {
      ctx.io.stdout(json({ id: comment.id, cardId: card.id, author: comment.authorName, body: comment.body, createdAt: comment.createdAt }))
      return
    }
    ctx.io.stdout(`Commented on ${shortId(card.id)} "${card.title}".\n`)
  },
}
