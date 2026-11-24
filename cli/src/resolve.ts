import type { BoardDetail, BoardSummary, Card, Column, Member, Tag } from '../../shared/types/board.ts'
import type { Client } from './client.ts'
import { CliError } from './io.ts'

/** One candidate a name may stand for, as listed in an ambiguity error. */
export interface Match {
  id: string
  name: string
}

/** A name that fits several things; `matches` lists them so the user can pick by id. */
export class AmbiguousError extends CliError {
  constructor(kind: string, ref: string, readonly matches: Match[]) {
    const sameName = new Set(matches.map(m => m.name.toLowerCase())).size === 1
    super(`"${ref}" matches ${matches.length} ${kind}s: ${matches.map(m => `${m.name} (${m.id})`).join(', ')}. Use the id${sameName ? '' : ' or the full name'}.`)
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(ref: string): boolean {
  return uuidPattern.test(ref)
}

/**
 * Finds the one item `ref` stands for: its id, an id prefix of at least 4
 * characters, its name (case-insensitively), else the items whose name
 * contains `ref`. Several fits at the first step that has any are an
 * AmbiguousError; none is a CliError naming `kind`.
 */
export function pick<T>(kind: string, ref: string, items: T[], id: (item: T) => string, names: (item: T) => string[]): T {
  const wanted = ref.trim().toLowerCase()
  if (!wanted) throw new CliError(`Empty ${kind} name.`)
  const label = (item: T) => names(item)[0] ?? id(item)
  const steps: ((item: T) => boolean)[] = [
    item => id(item).toLowerCase() === wanted,
    item => wanted.length >= 4 && /^[0-9a-f-]+$/.test(wanted) && id(item).toLowerCase().startsWith(wanted),
    item => names(item).some(n => n.toLowerCase() === wanted),
    item => names(item).some(n => n.toLowerCase().includes(wanted)),
  ]
  for (const step of steps) {
    const found = items.filter(step)
    if (found.length === 1) return found[0]!
    if (found.length > 1) throw new AmbiguousError(kind, ref, found.map(f => ({ id: id(f), name: label(f) })))
  }
  throw new CliError(`No ${kind} matches "${ref}".`)
}

/** The board for an id or name (archived boards included), loaded in full. */
export async function loadBoard(client: Client, ref: string): Promise<BoardDetail> {
  if (isUuid(ref)) return client.get<BoardDetail>(`/api/boards/${ref}`)
  const boards = await client.get<BoardSummary[]>('/api/boards')
  const board = pick('board', ref, boards, b => b.id, b => [b.name])
  return client.get<BoardDetail>(`/api/boards/${board.id}`)
}

export function findColumn(board: BoardDetail, ref: string): Column {
  return pick('column', ref, board.columns, c => c.id, c => [c.title])
}

export function findTag(board: BoardDetail, ref: string): Tag {
  return pick('tag', ref, board.tags, t => t.id, t => [t.name])
}

/** A board member by email, name or user id; `me` is the token's user (`meId`). */
export function findMember(board: BoardDetail, ref: string, meId?: string): Member {
  if (ref.toLowerCase() === 'me' && meId) {
    const me = board.members.find(m => m.userId === meId)
    if (me) return me
    throw new CliError('You are not a member of this board.')
  }
  // An exact email wins over a name that contains it.
  const byEmail = board.members.filter(m => m.email.toLowerCase() === ref.trim().toLowerCase())
  if (byEmail.length === 1) return byEmail[0]!
  return pick('member', ref, board.members, m => m.userId, m => [m.name, m.email])
}

/** A card shown on the board by id, id prefix or title. */
export function findCard(board: BoardDetail, ref: string): Card {
  return pick('card', ref, board.cards, c => c.id, c => [c.title])
}

/** A card's id: a card shown on the board, or any full id (archived cards are not on the board). */
export function cardId(board: BoardDetail, ref: string): string {
  if (isUuid(ref) && !board.cards.some(c => c.id === ref)) return ref
  return findCard(board, ref).id
}
