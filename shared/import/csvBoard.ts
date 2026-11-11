import type { BoardExport } from '../boardExport'
import { CARD_TITLE_MAX } from '../cards'
import type { Priority } from '../types/board'
import { clip, noSkips, palette, toDate, type ConvertResult } from './common'
import { parseCsv } from './csv'

type Role = 'title' | 'key' | 'description' | 'column' | 'tags' | 'assignees' | 'due' | 'start' | 'priority' | 'estimate' | 'archived'

// Recognised headers, compared lower case with Jira's "Custom field (...)" wrapper removed.
const headerRoles: Record<string, Role> = Object.fromEntries(Object.entries({
  title: ['title', 'summary', 'name', 'card name', 'card', 'task', 'task name'],
  key: ['issue key', 'key'],
  description: ['description', 'desc', 'details'],
  column: ['status', 'column', 'list', 'stage', 'state'],
  tags: ['labels', 'label', 'tags', 'tag'],
  assignees: ['assignee', 'assignees', 'assigned to', 'owner', 'members'],
  due: ['due', 'due date', 'duedate', 'due on'],
  start: ['start', 'start date', 'startdate'],
  priority: ['priority'],
  estimate: ['estimate', 'story points', 'story point estimate', 'points'],
  archived: ['archived'],
} satisfies Record<Role, string[]>).flatMap(([role, names]) => names.map(n => [n, role as Role])))

const priorityNames: Record<string, Priority> = {
  urgent: 'urgent', highest: 'urgent', blocker: 'urgent', critical: 'urgent',
  high: 'high', major: 'high',
  medium: 'medium', normal: 'medium',
  low: 'low', lowest: 'low', minor: 'low', trivial: 'low',
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/^custom field \((.*)\)$/, '$1').replace(/\s+/g, ' ')

/** Our CSV export prefixes formula-looking cells with ' for spreadsheets; take it off again. */
const unescapeCell = (s: string) => /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s

const splitList = (s: string) => s.split(/[,;]/).map(v => v.trim()).filter(Boolean)

export interface CsvOptions {
  /** Board name (a CSV has none). */
  name: string
  /** Put Jira's issue key in front of the title ("KAN-12 Fix login"). */
  issueKeys?: boolean
}

/** The file has an "Issue key" column (Jira), so the issueKeys option applies. */
export function csvHasIssueKeys(text: string): boolean {
  return (parseCsv(text.slice(0, text.search(/\r|\n|$/)))[0] ?? []).some(h => headerRoles[normalizeHeader(h)] === 'key')
}

/**
 * Converts a CSV with a header row (a generic sheet, a Jira export, or our own
 * CSV export) into our export shape. Headers are matched case-insensitively;
 * a header may repeat (Jira writes one "Labels" column per label): list
 * columns (labels, assignees) are merged, other columns take the first
 * non-empty cell. Columns are created in order of first appearance. Labels
 * and assignees are split on commas and semicolons; assignees may be emails
 * or names. Rows without a title are dropped, and unreadable dates,
 * priorities and estimates are left empty; both are counted.
 */
export function csvToBoard(text: string, options: CsvOptions): ConvertResult {
  const [header, ...rows] = parseCsv(text)
  if (!header) throw new Error('The CSV file is empty.')
  const roles = header.map(h => headerRoles[normalizeHeader(h)])
  if (!roles.includes('title')) throw new Error('The CSV file needs a Title, Summary or Name column.')
  const ignoredColumns = [...new Set(header.filter((h, i) => !roles[i] && h.trim()).map(h => h.trim()))]
  const skipped = noSkips()

  const columns: string[] = []
  const tagColors = new Map<string, string>()
  const cards: NonNullable<BoardExport['cards']> = []
  for (const row of rows) {
    const cells = (role: Role) => row.flatMap((v, i) => roles[i] === role ? [unescapeCell(v).trim()] : []).filter(Boolean)
    const first = (role: Role) => cells(role)[0] ?? ''
    let title = first('title')
    if (options.issueKeys && first('key')) title = `${first('key')} ${title}`
    title = clip(title, CARD_TITLE_MAX)
    if (!first('title')) {
      skipped.cards++
      continue
    }

    const column = clip(first('column'), 100) || (roles.includes('column') ? 'No status' : 'To do')
    if (!columns.includes(column)) columns.push(column)

    const tags = [...new Set(cells('tags').flatMap(splitList).map(t => clip(t, 50)))]
    for (const t of tags) if (!tagColors.has(t)) tagColors.set(t, palette[tagColors.size % palette.length]!)

    const date = (role: Role) => {
      const raw = first(role)
      const d = raw ? toDate(raw) : null
      if (raw && !d) skipped.invalidValues++
      return d
    }
    const rawPriority = first('priority').toLowerCase()
    const priority = priorityNames[rawPriority] ?? null
    if (rawPriority && !priority) skipped.invalidValues++
    const rawEstimate = first('estimate')
    let estimate: number | null = rawEstimate ? Number(rawEstimate.replace(',', '.')) : null
    if (estimate !== null && !(Number.isFinite(estimate) && estimate >= 0 && estimate <= 9999)) {
      skipped.invalidValues++
      estimate = null
    }

    cards.push({
      column,
      title,
      description: first('description').slice(0, 10_000),
      startDate: date('start'),
      dueDate: date('due'),
      priority,
      estimate,
      archived: ['yes', 'true', '1', 'y'].includes(first('archived').toLowerCase()),
      tags,
      assignees: [...new Set(cells('assignees').flatMap(splitList))],
    })
  }

  return {
    data: {
      name: clip(options.name, 100) || 'Imported board',
      columns: columns.map(title => ({ title })),
      tags: [...tagColors].map(([name, color]) => ({ name, color })),
      cards,
    },
    skipped,
    ignoredColumns,
  }
}
