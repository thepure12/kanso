import type { Me } from '../../../shared/types/account.ts'
import type { BoardDetail, Card } from '../../../shared/types/board.ts'
import { type Client, createClient } from '../client.ts'
import { loadConfig, resolveCredentials } from '../config.ts'
import { UsageError } from '../io.ts'
import type { Context } from './types.ts'

/** A client for the chosen profile (or KANSO_URL / KANSO_TOKEN). */
export async function connect(ctx: Context): Promise<Client> {
  const creds = resolveCredentials(await loadConfig(ctx.configPath), ctx.profile, ctx.io.env)
  return createClient(creds, ctx.io.fetch)
}

export async function meId(client: Client): Promise<string> {
  return (await client.get<Me>('/api/me')).id
}

/** Exactly `names.length` positionals, else a usage error naming the first missing one. */
export function positionals(ctx: Context, ...names: string[]): string[] {
  const got = ctx.positionals
  if (got.length < names.length) throw new UsageError(`Missing ${names[got.length]}.`)
  if (got.length > names.length) throw new UsageError(`Unexpected argument "${got[names.length]}".`)
  return got
}

export function stringOption(ctx: Context, name: string): string | undefined {
  const v = ctx.values[name]
  return typeof v === 'string' ? v : undefined
}

export function listOption(ctx: Context, name: string): string[] {
  const v = ctx.values[name]
  return Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
}

export const priorities = ['urgent', 'high', 'medium', 'low'] as const

/** `none` clears; otherwise one of the priorities. */
export function parsePriority(value: string): (typeof priorities)[number] | null {
  const p = value.toLowerCase()
  if (p === 'none') return null
  if ((priorities as readonly string[]).includes(p)) return p as (typeof priorities)[number]
  throw new UsageError(`Priority must be one of ${priorities.join(', ')} or none.`)
}

/** YYYY-MM-DD (a real date), or `none` to clear. */
export function parseDate(value: string, option: string): string | null {
  if (value.toLowerCase() === 'none') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const d = m && new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!))
  if (!d || d.toISOString().slice(0, 10) !== value) throw new UsageError(`--${option} must be a date as YYYY-MM-DD, or none.`)
  return value
}

/** The first 8 characters of an id: enough to tell cards apart, and accepted back as an id prefix. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}

/** A board card with names next to ids, for --json and text output. */
export function cardView(board: BoardDetail, card: Card) {
  const tag = new Map(board.tags.map(t => [t.id, t.name]))
  const member = new Map(board.members.map(m => [m.userId, m]))
  return {
    id: card.id,
    title: card.title,
    columnId: card.columnId,
    column: board.columns.find(c => c.id === card.columnId)?.title ?? null,
    tags: card.tagIds.map(id => ({ id, name: tag.get(id) ?? id })),
    assignees: card.assigneeIds.map(id => ({ id, name: member.get(id)?.name ?? id, email: member.get(id)?.isBot ? null : (member.get(id)?.email ?? null) })),
    startDate: card.startDate,
    dueDate: card.dueDate,
    priority: card.priority,
    estimate: card.estimate,
    checklist: card.checklist,
    comments: card.commentCount,
  }
}

/** Cards of a board in board order: by column, then position. */
export function boardOrder(board: BoardDetail, cards = board.cards): Card[] {
  const col = new Map(board.columns.map((c, i) => [c.id, i]))
  return [...cards].sort((a, b) => (col.get(a.columnId) ?? 0) - (col.get(b.columnId) ?? 0) || a.position - b.position)
}

/** "YYYY-MM-DD HH:MM" in local time. */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
