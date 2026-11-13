import { randomUUID } from 'node:crypto'
import { and, inArray, or, sql, TransactionRollbackError } from 'drizzle-orm'
import { z } from 'zod'
import { boardExportSchema, type BoardImport } from '#shared/boardExport'
import { convertImport, detectImportFormat, importFormats, type ConvertResult } from '#shared/import'
import { isValidFieldValue } from '#shared/fields'
import type { BoardField } from '#shared/types/board'

const MAX_BYTES = 5 * 1024 * 1024
const CHUNK = 500

const body = z.object({
  name: z.string().trim().min(1).max(100),
  teamId: z.uuid().nullable().default(null),
  // Our JSON export, a Trello JSON export (both parsed) or CSV text; detected when left out.
  format: z.enum(importFormats).optional(),
  data: z.unknown(),
  // CSV: put Jira's issue key in front of card titles.
  issueKeys: z.boolean().default(false),
  // Runs the whole import and rolls it back, for the dialog's preview.
  dryRun: z.boolean().default(false),
})

/**
 * Creates a board from an export. Trello and CSV files are first converted to
 * our export shape (shared/import), whose skipped counts are added to the
 * response. A dry run returns the same response with `id: null` and leaves
 * nothing behind (the import runs in a savepoint that is rolled back).
 */
export default defineUserHandler(async (event, tx, userId) => {
  if (Number(getHeader(event, 'content-length') ?? 0) > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'The file is too large (5 MB at most)' })
  }
  const { name, teamId, format, data, issueKeys, dryRun } = await readValidated(event, body)
  let converted: ConvertResult
  try { converted = convertImport(format ?? detectImportFormat(data), data, { name, issueKeys }) }
  catch (err) { throw createError({ statusCode: 400, statusMessage: (err as Error).message }) }
  const parsed = boardExportSchema.safeParse(converted.data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw createError({ statusCode: 400, statusMessage: `The file cannot be imported (${issue?.path.join('.') || 'file'}: ${issue?.message})` })
  }
  const run = async (tx: Tx) => {
    const result = await importBoard(tx, userId, name, teamId, parsed.data)
    return {
      ...result,
      skipped: { ...result.skipped, ...converted.skipped },
      ignoredColumns: converted.ignoredColumns,
      counts: { columns: parsed.data.columns.length, cards: parsed.data.cards.length, tags: parsed.data.tags.length },
    }
  }
  if (!dryRun) return run(tx)
  let preview: Awaited<ReturnType<typeof run>> | undefined
  try {
    await tx.transaction(async (sp) => {
      preview = await run(sp)
      sp.rollback()
    })
  }
  catch (err) { if (!(err instanceof TransactionRollbackError)) throw err }
  return { ...preview!, id: null }
})

/**
 * Creates a board from a JSON export: columns, tags, custom fields, cards with
 * their tags, checklists, assignees and field values, card links, and column rules. Assignees and rule users are
 * matched by email (or by name, when there is no @ and the name is unique)
 * among people who can access the new board, and unmatched ones are listed; others are
 * skipped and counted, as are links to missing cards, duplicates, links
 * that would close a blocking cycle, and field values for unknown fields or
 * that do not fit their field. Comments are imported without an author, under
 * the original author's name (imported_author), with their original time; they
 * log no activity. Attachments are not imported. Rules go in
 * last so they do not fire on the imported cards (as in app.copy_board), and
 * a board created in this transaction notifies nobody.
 */
async function importBoard(tx: Tx, userId: string, name: string, teamId: string | null, data: BoardImport) {
  const [board] = await tx.execute<{ id: string }>(sql`select id from app.create_board(${name}, ${teamId})`)
  const boardId = board!.id
  const skipped = { assignees: 0, rules: 0, links: 0, fieldValues: 0 }

  // Columns keep their order; cards refer to them by title (first match wins).
  const columnRows = data.columns.map((c, i) => ({
    id: randomUUID(), boardId, title: c.title, color: c.color ?? null, wipLimit: c.wipLimit ?? null, outline: c.outline ?? null, position: (i + 1) * 1024,
  }))
  if (columnRows.length) await tx.insert(schema.columns).values(columnRows)
  const columnId = new Map<string, string>()
  for (const c of columnRows) if (!columnId.has(c.title)) columnId.set(c.title, c.id)

  // Group names are unique regardless of case (first one wins); unknown column titles are skipped.
  const groupRows = [...new Map(data.columnGroups.map(g => [g.name.toLowerCase(), g])).values()].map((g, i) => ({
    id: randomUUID(), boardId, name: g.name, color: g.color ?? null, position: (i + 1) * 1024,
    columnIds: [...new Set(g.columns.flatMap(t => columnId.get(t.trim()) ?? []))],
  }))
  if (groupRows.length) {
    await tx.insert(schema.columnGroups).values(groupRows.map(({ columnIds: _, ...g }) => g))
    const members = groupRows.flatMap(g => g.columnIds.map(columnId => ({ groupId: g.id, columnId, boardId })))
    if (members.length) await tx.insert(schema.columnGroupMembers).values(members)
  }

  const tagRows = [...new Map(data.tags.map(t => [t.name, t])).values()].map(t => ({ id: randomUUID(), boardId, ...t }))
  if (tagRows.length) await tx.insert(schema.tags).values(tagRows)
  const tagId = new Map(tagRows.map(t => [t.name, t.id]))

  // Field names are unique regardless of case (first one wins); options get new ids.
  const fieldRows = [...new Map(data.fields.map(f => [f.name.toLowerCase(), f])).values()].map((f, i) => ({
    id: randomUUID(), boardId, name: f.name, kind: f.kind, showOnCard: f.showOnCard, position: (i + 1) * 1024,
    options: f.kind === 'select' ? f.options.map(o => ({ id: randomUUID(), ...o })) : [],
  }))
  if (fieldRows.length) await tx.insert(schema.boardFields).values(fieldRows)
  const fieldByName = new Map(fieldRows.map(f => [f.name.toLowerCase(), f as Pick<BoardField, 'id' | 'kind' | 'options'>]))

  // People who can access the new board, by lower-case email or name (RLS on
  // users already hides everyone the caller shares no board with). A name
  // shared by several of them matches nobody.
  const wanted = [...new Set([
    ...data.cards.flatMap(c => c.assignees),
    ...data.columns.flatMap(c => c.rules.flatMap(r => 'user' in r && r.user ? [r.user] : [])),
    // Comment authors only by email, and only when the export has no name for them.
    ...data.cards.flatMap(c => c.comments.flatMap(m => !m.authorName?.trim() && m.author?.includes('@') ? [m.author] : [])),
  ].map(e => e.trim().toLowerCase()))]
  const emails = wanted.filter(w => w.includes('@'))
  const names = wanted.filter(w => !w.includes('@'))
  const people = wanted.length
    ? await tx.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name }).from(schema.users)
      .where(and(
        or(emails.length ? inArray(sql`lower(${schema.users.email})`, emails) : undefined, names.length ? inArray(sql`lower(${schema.users.name})`, names) : undefined),
        sql`app.is_member(${boardId}, ${schema.users.id})`,
      ))
    : []
  const byEmail = new Map(people.map(p => [p.email.toLowerCase(), p.id]))
  const byName = new Map<string, string | null>()
  for (const p of people) {
    const key = p.name.trim().toLowerCase()
    byName.set(key, byName.has(key) ? null : p.id)
  }
  const personId = { get: (s: string) => (s.includes('@') ? byEmail.get(s.trim()) : byName.get(s.trim())) ?? undefined }
  const unmatched = new Set<string>()
  const personName = new Map(people.map(p => [p.id, p.name]))
  // The name shown on an imported comment: the export's, else the matched
  // person's, else the email's local part (never the whole email).
  const commentAuthor = (m: BoardImport['cards'][number]['comments'][number]) => {
    const email = m.author?.trim() ?? ''
    const matched = email.includes('@') ? personName.get(byEmail.get(email.toLowerCase()) ?? '') : undefined
    return (m.authorName?.trim() || matched || email.split('@')[0]!.trim() || 'Unknown').slice(0, 100)
  }
  const importedAt = new Date()
  const commentTime = (s: string | null | undefined) => {
    const d = s ? new Date(s) : importedAt
    return Number.isNaN(d.getTime()) || d > importedAt ? importedAt : d
  }

  const nextPosition = new Map<string, number>()
  const cardRows: (typeof schema.cards.$inferInsert)[] = []
  const cardTagRows: (typeof schema.cardTags.$inferInsert)[] = []
  const assigneeRows: (typeof schema.cardAssignees.$inferInsert)[] = []
  const checklistRows: (typeof schema.checklistItems.$inferInsert)[] = []
  const valueRows: (typeof schema.cardFieldValues.$inferInsert)[] = []
  const commentRows: (typeof schema.cardComments.$inferInsert)[] = []
  for (const c of data.cards) {
    const col = columnId.get(c.column.trim())
    if (!col) throw createError({ statusCode: 400, statusMessage: `Card "${c.title}" is in a column that does not exist: "${c.column}"` })
    const position = (nextPosition.get(col) ?? 0) + 1024
    nextPosition.set(col, position)
    const id = randomUUID()
    cardRows.push({
      id, boardId, columnId: col, title: c.title, description: c.description, position, createdBy: userId,
      startDate: c.startDate ?? null, dueDate: c.dueDate ?? null, priority: c.priority ?? null, estimate: c.estimate ?? null,
      archivedAt: c.archived ? new Date() : null,
    })
    for (const t of new Set(c.tags)) {
      const tag = tagId.get(t)
      if (tag) cardTagRows.push({ cardId: id, tagId: tag, boardId })
    }
    const assigned = new Set<string>()
    for (const a of new Set(c.assignees.map(a => a.trim()))) {
      const user = personId.get(a.toLowerCase())
      if (user && !assigned.has(user)) {
        assigned.add(user)
        assigneeRows.push({ cardId: id, userId: user, boardId })
      }
      else if (!user) {
        skipped.assignees++
        unmatched.add(a)
      }
    }
    c.checklist.forEach((item, i) => checklistRows.push({ cardId: id, boardId, text: item.text, done: item.done, position: (i + 1) * 1024 }))
    const valued = new Set<string>()
    for (const [name, raw] of Object.entries(c.fieldValues)) {
      const field = fieldByName.get(name.trim().toLowerCase())
      const value = field?.kind === 'select' ? field.options.find(o => o.label === raw)?.id : raw
      if (field && isValidFieldValue(field, value) && !valued.has(field.id)) {
        valued.add(field.id)
        valueRows.push({ cardId: id, boardId, fieldId: field.id, value })
      }
      else skipped.fieldValues++
    }
    for (const m of c.comments) {
      const at = commentTime(m.createdAt)
      commentRows.push({ cardId: id, boardId, authorId: null, importedAuthor: commentAuthor(m), body: m.body, createdAt: at, updatedAt: at })
    }
  }

  // Same checks as the database (self links, duplicates, symmetric relates,
  // blocking cycles), so one bad link does not fail the whole import.
  const linkRows: (typeof schema.cardLinks.$inferInsert)[] = []
  const seenLinks = new Set<string>()
  const blocks = new Map<string, string[]>()
  const reaches = (from: string, target: string) => {
    const stack = [from]
    const seen = new Set<string>()
    while (stack.length) {
      const c = stack.pop()!
      if (c === target) return true
      if (seen.has(c)) continue
      seen.add(c)
      stack.push(...blocks.get(c) ?? [])
    }
    return false
  }
  for (const l of data.links) {
    const from = cardRows[l.from]?.id
    const to = cardRows[l.to]?.id
    const key = l.kind === 'relates' ? `relates:${[from, to].sort().join(':')}` : `${l.kind}:${from}:${to}`
    if (!from || !to || from === to || seenLinks.has(key) || (l.kind === 'blocks' && reaches(to, from))) {
      skipped.links++
      continue
    }
    seenLinks.add(key)
    if (l.kind === 'blocks') blocks.set(from, [...blocks.get(from) ?? [], to])
    linkRows.push({ boardId, fromCardId: from, toCardId: to, kind: l.kind, createdBy: userId })
  }

  const ruleRows: (typeof schema.columnRules.$inferInsert)[] = []
  const seenRules = new Set<string>()
  data.columns.forEach((c, i) => {
    for (const r of c.rules) {
      const row: typeof schema.columnRules.$inferInsert = { boardId, columnId: columnRows[i]!.id, kind: r.kind }
      if (r.kind === 'set_due') row.dueDays = r.dueDays
      else if (r.kind === 'assign_to') row.userId = r.user ? personId.get(r.user.toLowerCase()) : undefined
      else if (r.kind !== 'assign_mover') row.tagId = r.tag ? tagId.get(r.tag) : undefined
      // Unknown tag or person, or a duplicate (one rule per kind and target, one due date
      // and one assign_mover per column).
      const key = `${row.columnId}:${row.kind}:${row.tagId ?? row.userId ?? ''}`
      const needsTarget = r.kind === 'apply_tag' || r.kind === 'remove_tag' || r.kind === 'assign_to'
      if ((needsTarget && !row.tagId && !row.userId) || seenRules.has(key)) {
        skipped.rules++
        continue
      }
      seenRules.add(key)
      ruleRows.push(row)
    }
  })

  for (const [table, rows] of [
    [schema.cards, cardRows],
    [schema.cardTags, cardTagRows],
    [schema.cardAssignees, assigneeRows],
    [schema.checklistItems, checklistRows],
    [schema.cardFieldValues, valueRows],
    [schema.cardComments, commentRows],
    [schema.cardLinks, linkRows],
    [schema.columnRules, ruleRows],
  ] as const) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.insert(table).values(rows.slice(i, i + CHUNK) as never)
    }
  }

  return { id: boardId as string | null, name, skipped, unmatched: [...unmatched].sort().slice(0, 100) }
}
