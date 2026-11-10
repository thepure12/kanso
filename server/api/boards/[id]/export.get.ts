import { asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { BOARD_EXPORT_VERSION } from '#shared/boardExport'
import type { FieldValue } from '#shared/types/board'

const query = z.object({ format: z.enum(['json', 'csv']).default('json') })

/** Spreadsheet-safe CSV cell: quoted, and formula-looking text prefixed with '. */
function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replaceAll('"', '""')}"`
}

function fileName(name: string, ext: string) {
  const base = name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'board'
  return `${base}.${ext}`
}

/** Downloads the board (everything the user can see, minus attachment contents) as JSON or as a CSV of cards. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { format } = await getValidatedQuery(event, q => query.parse(q))
  const { boards, columns, columnRules, tags, checklistItems: ci, cardComments: cc, cardAttachments: ca, cardLinks, cardFieldValues: fv, users } = schema

  const [board] = await tx.select({ name: boards.name }).from(boards).where(eq(boards.id, id))
  if (!board) notFound('Board not found')

  const [cols, rules, tagRows, cards, people, checklist, comments, attachments, links, fields, values, columnGroups] = await Promise.all([
    tx.select({ id: columns.id, title: columns.title, color: columns.color, wipLimit: columns.wipLimit })
      .from(columns).where(eq(columns.boardId, id)).orderBy(asc(columns.position)),
    tx.select({ ...columnRuleFields, columnId: columnRules.columnId }).from(columnRules).where(eq(columnRules.boardId, id)),
    tx.select({ id: tags.id, name: tags.name, color: tags.color }).from(tags).where(eq(tags.boardId, id)).orderBy(asc(tags.name)),
    tx.execute<{ id: string, columnId: string, title: string, description: string, startDate: string | null, dueDate: string | null, priority: string | null, estimate: number | null, archivedAt: string | null, createdAt: string, tagIds: string[], assigneeIds: string[] }>(sql`
      select c.id, c.column_id as "columnId", c.title, c.description, c.start_date::text as "startDate",
             c.due_date::text as "dueDate", c.priority, c.estimate::float8 as estimate,
             c.archived_at as "archivedAt", c.created_at as "createdAt",
             array(select ct.tag_id::text from card_tags ct where ct.card_id = c.id) as "tagIds",
             array(select a.user_id::text from card_assignees a where a.card_id = c.id) as "assigneeIds"
      from cards c join columns col on col.id = c.column_id
      where c.board_id = ${id} and not c.is_template
      order by col.position, c.position
    `),
    tx.select({ id: users.id, name: users.name, email: users.email }).from(users),
    tx.select({ cardId: ci.cardId, text: ci.text, done: ci.done }).from(ci).where(eq(ci.boardId, id)).orderBy(asc(ci.position)),
    tx.select({ cardId: cc.cardId, authorId: cc.authorId, importedAuthor: cc.importedAuthor, body: cc.body, createdAt: cc.createdAt })
      .from(cc).where(eq(cc.boardId, id)).orderBy(asc(cc.createdAt)),
    tx.select({ cardId: ca.cardId, name: ca.name, contentType: ca.contentType, size: ca.size })
      .from(ca).where(eq(ca.boardId, id)).orderBy(asc(ca.createdAt)),
    tx.select({ fromCardId: cardLinks.fromCardId, toCardId: cardLinks.toCardId, kind: cardLinks.kind })
      .from(cardLinks).where(eq(cardLinks.boardId, id)).orderBy(asc(cardLinks.createdAt)),
    loadBoardFields(tx, id),
    tx.select({ cardId: fv.cardId, fieldId: fv.fieldId, value: fv.value }).from(fv).where(eq(fv.boardId, id)),
    loadColumnGroups(tx, id),
  ])

  const colTitle = new Map(cols.map(c => [c.id, c.title]))
  const tagName = new Map(tagRows.map(t => [t.id, t.name]))
  const person = new Map(people.map(p => [p.id, p]))
  const by = <T extends { cardId: string }>(rows: T[]) => Map.groupBy(rows, r => r.cardId)
  const [checklistBy, commentsBy, attachmentsBy, valuesBy] = [by(checklist), by(comments), by(attachments), by(values)]
  const fieldById = new Map(fields.map(f => [f.id, f]))
  // Select values by option label, as the import expects.
  const exportValue = (fieldId: string, value: unknown) => {
    const f = fieldById.get(fieldId)!
    return f.kind === 'select' ? f.options.find(o => o.id === value)?.label ?? null : value as FieldValue
  }

  const cardIndex = new Map([...cards].map((c, i) => [c.id, i]))
  const cardList = [...cards].map(c => ({
    column: colTitle.get(c.columnId)!,
    title: c.title,
    description: c.description,
    startDate: c.startDate,
    dueDate: c.dueDate,
    priority: c.priority,
    estimate: c.estimate,
    archived: c.archivedAt !== null,
    createdAt: c.createdAt,
    tags: c.tagIds.map(t => tagName.get(t)!).sort(),
    assignees: c.assigneeIds.map(u => person.get(u)?.email ?? null).filter(e => e !== null),
    checklist: (checklistBy.get(c.id) ?? []).map(({ text, done }) => ({ text, done })),
    comments: (commentsBy.get(c.id) ?? []).map((m) => {
      const author = m.authorId ? person.get(m.authorId) : undefined
      return { author: author?.email ?? null, authorName: author?.name ?? m.importedAuthor, body: m.body, createdAt: m.createdAt }
    }),
    attachments: (attachmentsBy.get(c.id) ?? []).map(({ name, contentType, size }) => ({ name, contentType, size })),
    fieldValues: Object.fromEntries((valuesBy.get(c.id) ?? [])
      .map(v => [fieldById.get(v.fieldId)!.name, exportValue(v.fieldId, v.value)] as const)
      .filter(([, v]) => v !== null)),
  }))

  if (format === 'csv') {
    const header = ['Column', 'Title', 'Description', 'Tags', 'Assignees', 'Start date', 'Due date', 'Priority', 'Estimate', 'Archived', 'Checklist', 'Comments', 'Attachments', 'Created', ...fields.map(f => f.name)]
    const lines = [header, ...cardList.map(c => [
      c.column, c.title, c.description, c.tags.join(', '), c.assignees.join(', '), c.startDate, c.dueDate, c.priority, c.estimate,
      c.archived ? 'yes' : 'no', c.checklist.length ? `${c.checklist.filter(i => i.done).length}/${c.checklist.length}` : '',
      c.comments.length, c.attachments.length, c.createdAt,
      ...fields.map((f) => {
        const v = c.fieldValues[f.name]
        return typeof v === 'boolean' ? (v ? 'yes' : 'no') : v
      }),
    ])].map(row => row.map(csvCell).join(','))
    setResponseHeaders(event, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName(board.name, 'csv')}"`,
    })
    return `﻿${lines.join('\r\n')}\r\n`
  }

  setResponseHeaders(event, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="${fileName(board.name, 'json')}"`,
  })
  return JSON.stringify({
    version: BOARD_EXPORT_VERSION,
    name: board.name,
    exportedAt: new Date().toISOString(),
    columns: cols.map(c => ({
      title: c.title,
      color: c.color,
      wipLimit: c.wipLimit,
      rules: rules.filter(r => r.columnId === c.id).map(({ columnId: _, ...r }) => {
        const { id: _id, ...rule } = toColumnRule(r)
        return 'tagId' in rule ? { kind: rule.kind, tag: tagName.get(rule.tagId) }
          : 'userId' in rule ? { kind: rule.kind, user: person.get(rule.userId)?.email ?? null }
            : rule
      }),
    })),
    tags: tagRows.map(({ name, color }) => ({ name, color })),
    columnGroups: columnGroups.map(g => ({ name: g.name, color: g.color, columns: g.columnIds.map(c => colTitle.get(c)!) })),
    fields: fields.map(f => ({ name: f.name, kind: f.kind, options: f.options.map(({ label, color }) => ({ label, color })), showOnCard: f.showOnCard })),
    cards: cardList,
    links: links.map(l => ({ from: cardIndex.get(l.fromCardId)!, to: cardIndex.get(l.toCardId)!, kind: l.kind })),
  }, null, 2)
})
