import type { BoardExport } from '../boardExport'

/**
 * What a converter could not carry over, counted for the import response:
 * cards it dropped (in archived Trello lists, CSV rows without a title),
 * comments and attachments (never imported), custom fields of kinds the board
 * has no equivalent for, and values it could not read (dates, priorities,
 * estimates, field values).
 */
export interface ConvertSkipped {
  cards: number
  comments: number
  attachments: number
  fields: number
  invalidValues: number
}

export interface ConvertResult {
  data: BoardExport
  skipped: ConvertSkipped
  /** CSV headers the importer does not recognise (their cells are dropped). */
  ignoredColumns: string[]
}

export const noSkips = (): ConvertSkipped => ({ cards: 0, comments: 0, attachments: 0, fields: 0, invalidValues: 0 })

/** Trims and cuts to the schema's length limit, so long foreign values do not fail the whole import. */
export const clip = (s: unknown, max: number) => (typeof s === 'string' ? s.trim() : '').slice(0, max)

/** Tag colours given out in turn when the source has none (the app's colour presets). */
export const palette = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#f97316', '#14b8a6', '#ec4899', '#64748b']

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

function ymd(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * A date as YYYY-MM-DD, or null when it cannot be read. Accepts ISO dates and
 * timestamps (the date part as written), Jira's default `14/Oct/26 10:00 AM`,
 * `14 Oct 2026`, and d.m.yyyy. Slash dates with numbers only are read
 * month first (US, as Jira and Excel write them) unless the first part is above 12.
 */
export function toDate(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) return null
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!)
  m = /^(\d{1,2})[/ -]([a-z]{3})[a-z]*[/ -](\d{2}|\d{4})\b/i.exec(s)
  if (m) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1
    const year = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!
    return month ? ymd(year, month, +m[1]!) : null
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(s)
  if (m) return ymd(+m[3]!, +m[2]!, +m[1]!)
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(s)
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!
    const [a, b] = [+m[1]!, +m[2]!]
    return a > 12 ? ymd(year, b, a) : ymd(year, a, b)
  }
  return null
}
