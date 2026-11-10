import { z } from 'zod'
import { fieldKinds } from './types/board'

/**
 * The JSON board export (GET /api/boards/:id/export) and the import
 * (POST /api/boards/import). Everything is referenced by name, title or email,
 * never by id. Unknown fields are ignored on import, and limits match what the
 * API accepts elsewhere. Fields added after version 1 (startDate, estimate,
 * links, fields, fieldValues, comments, columnGroups) are optional, so older exports still import.
 * Links refer to cards by their index in `cards`. A card's fieldValues map
 * field names to values, with select values given by option label. Comments
 * name their author by email (`author`, for older exports) and by display name
 * (`authorName`); they are imported as written by that name, not by a user.
 * Column groups list their columns by title (first match wins, unknown ones are skipped).
 */
export const BOARD_EXPORT_VERSION = 1
export const MAX_IMPORT_CARDS = 5000
export const MAX_IMPORT_COMMENTS = 1000

const color = z.string().regex(/^#[0-9a-f]{6}$/i).transform(c => c.toLowerCase())

const rule = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['apply_tag', 'remove_tag']), tag: z.string().nullish() }),
  z.object({ kind: z.literal('assign_to'), user: z.string().nullish() }),
  z.object({ kind: z.literal('set_due'), dueDays: z.number().int().min(0).max(365) }),
])

export const boardExportSchema = z.object({
  version: z.literal(BOARD_EXPORT_VERSION).optional(),
  name: z.string().trim().min(1).max(100),
  columns: z.array(z.object({
    title: z.string().trim().min(1).max(100),
    color: color.nullish(),
    wipLimit: z.number().int().min(1).max(999).nullish(),
    rules: z.array(rule).max(50).default([]),
  })).max(100),
  tags: z.array(z.object({ name: z.string().trim().min(1).max(50), color })).max(200).default([]),
  columnGroups: z.array(z.object({
    name: z.string().trim().min(1).max(50),
    color: color.nullish(),
    columns: z.array(z.string()).max(100).default([]),
  })).max(100).default([]),
  fields: z.array(z.object({
    name: z.string().trim().min(1).max(50),
    kind: z.enum(fieldKinds),
    options: z.array(z.object({ label: z.string().trim().min(1).max(50), color })).max(100).default([]),
    showOnCard: z.boolean().default(false),
  })).max(100).default([]),
  cards: z.array(z.object({
    column: z.string(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).default(''),
    startDate: z.iso.date().nullish(),
    dueDate: z.iso.date().nullish(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).nullish(),
    estimate: z.number().min(0).max(9999).nullish(),
    archived: z.boolean().default(false),
    tags: z.array(z.string()).max(50).default([]),
    assignees: z.array(z.string()).max(50).default([]),
    checklist: z.array(z.object({ text: z.string().trim().min(1).max(500), done: z.boolean().default(false) })).max(200).default([]),
    fieldValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    comments: z.array(z.object({
      author: z.string().max(320).nullish(),
      authorName: z.string().max(200).nullish(),
      body: z.string().trim().min(1).max(10_000),
      // An ISO timestamp; missing, unreadable or future ones become the import time.
      createdAt: z.string().max(64).nullish(),
    })).max(MAX_IMPORT_COMMENTS).default([]),
  })).max(MAX_IMPORT_CARDS).default([]),
  links: z.array(z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    kind: z.enum(['blocks', 'relates', 'duplicates']),
  })).max(20_000).default([]),
})

export type BoardExport = z.input<typeof boardExportSchema>
export type BoardImport = z.output<typeof boardExportSchema>
