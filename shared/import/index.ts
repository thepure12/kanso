import type { BoardExport } from '../boardExport'
import { noSkips, type ConvertResult } from './common'
import { csvToBoard } from './csvBoard'
import { isTrelloExport, trelloToBoard } from './trello'

export type { ConvertResult, ConvertSkipped } from './common'
export { csvHasIssueKeys } from './csvBoard'

export const importFormats = ['kanban', 'trello', 'csv'] as const
export type ImportFormat = (typeof importFormats)[number]

/** A CSV file arrives as a string, JSON as parsed data: a Trello export, or else ours. */
export function detectImportFormat(data: unknown): ImportFormat {
  if (typeof data === 'string') return 'csv'
  return isTrelloExport(data) ? 'trello' : 'kanban'
}

/**
 * Turns an uploaded file into our export shape, so every format goes through
 * the one import. `kanban` data passes through unchanged (the import
 * validates it). Throws an Error with a readable message on a file it cannot
 * read as `format`.
 */
export function convertImport(format: ImportFormat, data: unknown, options: { name: string, issueKeys?: boolean }): ConvertResult {
  if (format === 'csv') {
    if (typeof data !== 'string') throw new Error('A CSV import needs the file as text.')
    return csvToBoard(data, options)
  }
  if (format === 'trello') {
    try { return trelloToBoard(data) }
    catch (err) {
      const issue = (err as { issues?: { path: PropertyKey[], message: string }[] }).issues?.[0]
      throw new Error(issue ? `This is not a Trello board export (${issue.path.join('.') || 'file'}: ${issue.message}).` : 'This is not a Trello board export.')
    }
  }
  return { data: data as BoardExport, skipped: noSkips(), ignoredColumns: [] }
}

/**
 * Trello exports carry the board's whole action history, which can be many
 * megabytes. Keeps only what trelloToBoard reads (comment actions, reduced to
 * their text, card, time and author), so the upload stays under the size limit.
 */
export function slimTrelloExport(json: Record<string, unknown>): Record<string, unknown> {
  const { name, lists, cards, labels, checklists, members, customFields, customFieldItems, actions } = json
  return {
    name, lists, cards, labels, checklists, members, customFields, customFieldItems,
    actions: Array.isArray(actions)
      ? actions.filter(a => a?.type === 'commentCard').map(({ type, date, idMemberCreator, memberCreator, data }) => ({
          type, date, idMemberCreator,
          memberCreator: memberCreator && { fullName: memberCreator.fullName, username: memberCreator.username },
          data: data && { text: data.text, card: data.card && { id: data.card.id } },
        }))
      : [],
  }
}
