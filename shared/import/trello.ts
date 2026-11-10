import { z } from 'zod'
import { type BoardExport, MAX_IMPORT_COMMENTS } from '../boardExport'
import type { FieldKind } from '../types/board'
import { clip, noSkips, toDate, type ConvertResult } from './common'

const id = z.string()
const customFieldItem = z.object({
  idCustomField: id,
  idModel: id.optional(),
  idValue: id.nullish(),
  value: z.record(z.string(), z.unknown()).nullish(),
})

/** The parts of a Trello board JSON export (Menu, Print and export, JSON) the importer reads; the rest is ignored. */
const trelloSchema = z.object({
  name: z.string().default('Trello board'),
  lists: z.array(z.object({ id, name: z.string(), closed: z.boolean().default(false), pos: z.number().default(0) })),
  cards: z.array(z.object({
    id,
    name: z.string().default(''),
    desc: z.string().default(''),
    closed: z.boolean().default(false),
    idList: id,
    pos: z.number().default(0),
    due: z.string().nullish(),
    start: z.string().nullish(),
    idLabels: z.array(id).default([]),
    idMembers: z.array(id).default([]),
    attachments: z.array(z.unknown()).optional(),
    badges: z.object({ attachments: z.number().optional() }).nullish(),
    customFieldItems: z.array(customFieldItem).optional(),
  })),
  labels: z.array(z.object({ id, name: z.string().nullish(), color: z.string().nullish() })).default([]),
  checklists: z.array(z.object({
    idCard: id,
    pos: z.number().default(0),
    checkItems: z.array(z.object({ name: z.string(), state: z.string().default('incomplete'), pos: z.number().default(0) })).default([]),
  })).default([]),
  members: z.array(z.object({ id, fullName: z.string().nullish(), username: z.string().nullish() })).default([]),
  customFields: z.array(z.object({
    id,
    name: z.string(),
    type: z.string(),
    display: z.object({ cardFront: z.boolean().optional() }).nullish(),
    options: z.array(z.object({ id, value: z.object({ text: z.string().optional() }).nullish(), color: z.string().nullish(), pos: z.number().default(0) })).default([]),
  })).default([]),
  customFieldItems: z.array(customFieldItem).default([]),
  // Every kind of action; only comments are read (commentAction), the rest is ignored.
  actions: z.array(z.object({ type: z.string() }).loose()).default([]),
})

const commentAction = z.object({
  type: z.literal('commentCard'),
  date: z.string().nullish(),
  idMemberCreator: id.nullish(),
  memberCreator: z.object({ fullName: z.string().nullish(), username: z.string().nullish() }).nullish(),
  data: z.object({ text: z.string().default(''), card: z.object({ id }) }),
})

/** Looks like a Trello board export rather than one of ours. */
export function isTrelloExport(json: unknown): boolean {
  const o = json as Record<string, unknown> | null
  return !!o && typeof o === 'object' && Array.isArray(o.lists) && Array.isArray(o.cards) && !('columns' in o)
}

// Trello's label colours (and their _light / _dark variants) as Tailwind 300 / 500 / 700.
const trelloColors: Record<string, [string, string, string]> = {
  green: ['#86efac', '#22c55e', '#15803d'],
  yellow: ['#fde047', '#eab308', '#a16207'],
  orange: ['#fdba74', '#f97316', '#c2410c'],
  red: ['#fca5a5', '#ef4444', '#b91c1c'],
  purple: ['#c4b5fd', '#8b5cf6', '#6d28d9'],
  blue: ['#93c5fd', '#3b82f6', '#1d4ed8'],
  sky: ['#7dd3fc', '#0ea5e9', '#0369a1'],
  lime: ['#bef264', '#84cc16', '#4d7c0f'],
  pink: ['#f9a8d4', '#ec4899', '#be185d'],
  black: ['#94a3b8', '#475569', '#1e293b'],
}

/** A Trello colour name as #rrggbb; no colour (or an unknown one) is grey. */
export function trelloColor(name: string | null | undefined): string {
  const [base, shade] = (name ?? '').split('_')
  const c = trelloColors[base ?? '']
  if (!c) return '#64748b'
  return shade === 'light' ? c[0] : shade === 'dark' ? c[2] : c[1]
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')

const fieldKinds: Record<string, FieldKind> = { text: 'text', number: 'number', date: 'date', checkbox: 'checkbox', list: 'select' }

/**
 * Converts a Trello board export into our export shape. Open lists become
 * columns (in Trello's order) and cards keep their order; cards in archived
 * lists are dropped, archived cards are imported as archived. Labels become
 * tags (a nameless label is named after its colour), checklists are joined
 * into the card's one checklist, and members become assignees by full name
 * (the export has no emails). Custom fields map to board fields where the
 * kind exists. Comments keep their author's name and time (oldest first);
 * comments on dropped cards and attachments are counted, not imported.
 */
export function trelloToBoard(json: unknown): ConvertResult {
  const t = trelloSchema.parse(json)
  const skipped = noSkips()

  const lists = t.lists.filter(l => !l.closed).sort((a, b) => a.pos - b.pos)
  const listIndex = new Map(lists.map((l, i) => [l.id, i]))
  // Our import matches cards to the first column with a title, so repeated list names get a number.
  const used = new Set<string>()
  const columnTitle = new Map(lists.map((l) => {
    const base = clip(l.name, 95) || 'Untitled'
    let title = base
    for (let n = 2; used.has(title); n++) title = `${base} (${n})`
    used.add(title)
    return [l.id, title]
  }))

  const labelName = new Map(t.labels.map(l => [l.id, clip(l.name, 50) || capitalize(l.color ?? 'label')]))
  const tags = [...new Map(t.labels.map(l => [labelName.get(l.id)!, { name: labelName.get(l.id)!, color: trelloColor(l.color) }])).values()]

  const memberName = new Map(t.members.map(m => [m.id, (m.fullName ?? '').trim() || (m.username ?? '').trim()]))

  const fields: NonNullable<BoardExport['fields']> = []
  const fieldById = new Map<string, { name: string, kind: FieldKind, options: Map<string, string> }>()
  for (const f of t.customFields) {
    const kind = fieldKinds[f.type]
    const name = clip(f.name, 50)
    if (!kind || !name) {
      skipped.fields++
      continue
    }
    const options = [...f.options].sort((a, b) => a.pos - b.pos)
      .map(o => ({ id: o.id, label: clip(o.value?.text, 50), color: trelloColor(o.color) }))
      .filter(o => o.label)
    fields.push({ name, kind, showOnCard: f.display?.cardFront ?? false, options: options.map(({ label, color }) => ({ label, color })) })
    fieldById.set(f.id, { name, kind, options: new Map(options.map(o => [o.id, o.label])) })
  }
  const looseItems = Map.groupBy(t.customFieldItems.filter(i => i.idModel), i => i.idModel!)

  const fieldValue = (kind: FieldKind, item: z.infer<typeof customFieldItem>, options: Map<string, string>) => {
    const v = item.value ?? {}
    switch (kind) {
      case 'text': return typeof v.text === 'string' ? v.text : undefined
      case 'number': {
        const n = Number(v.number)
        return v.number != null && v.number !== '' && Number.isFinite(n) ? n : undefined
      }
      case 'date': return toDate(v.date) ?? undefined
      case 'checkbox': return v.checked === 'true' || v.checked === true
      case 'select': return item.idValue ? options.get(item.idValue) : undefined
    }
  }

  // Trello lists actions newest first.
  const comments = Map.groupBy(t.actions.flatMap((a) => {
    if (a.type !== 'commentCard') return []
    const c = commentAction.safeParse(a)
    if (!c.success || !c.data.data.text.trim()) {
      skipped.comments++
      return []
    }
    return [c.data]
  }).reverse(), c => c.data.card.id)
  const commentName = (c: z.infer<typeof commentAction>) =>
    (c.memberCreator?.fullName ?? '').trim() || (c.memberCreator?.username ?? '').trim() || (c.idMemberCreator ? memberName.get(c.idMemberCreator) : '') || null

  const checklists = Map.groupBy([...t.checklists].sort((a, b) => a.pos - b.pos), c => c.idCard)
  const date = (s: string | null | undefined) => {
    if (!s) return null
    const d = toDate(s)
    if (!d) skipped.invalidValues++
    return d
  }

  const cards: NonNullable<BoardExport['cards']> = []
  for (const c of [...t.cards].sort((a, b) => (listIndex.get(a.idList) ?? 0) - (listIndex.get(b.idList) ?? 0) || a.pos - b.pos)) {
    const cardComments = comments.get(c.id) ?? []
    comments.delete(c.id)
    if (!listIndex.has(c.idList)) {
      skipped.cards++
      skipped.comments += cardComments.length
      continue
    }
    skipped.comments += Math.max(0, cardComments.length - MAX_IMPORT_COMMENTS)
    skipped.attachments += c.attachments?.length ?? c.badges?.attachments ?? 0
    const fieldValues: Record<string, string | number | boolean> = {}
    for (const item of [...c.customFieldItems ?? [], ...looseItems.get(c.id) ?? []]) {
      const field = fieldById.get(item.idCustomField)
      if (!field) continue
      const value = fieldValue(field.kind, item, field.options)
      if (value === undefined) skipped.invalidValues++
      else fieldValues[field.name] = value
    }
    cards.push({
      column: columnTitle.get(c.idList)!,
      title: clip(c.name, 200) || 'Untitled',
      description: c.desc.slice(0, 10_000),
      startDate: date(c.start),
      dueDate: date(c.due),
      archived: c.closed,
      tags: [...new Set(c.idLabels.map(l => labelName.get(l)).filter(n => n !== undefined))],
      assignees: [...new Set(c.idMembers.map(m => memberName.get(m)).filter(n => !!n))] as string[],
      checklist: (checklists.get(c.id) ?? []).flatMap(list => [...list.checkItems].sort((a, b) => a.pos - b.pos))
        .map(i => ({ text: clip(i.name, 500), done: i.state === 'complete' }))
        .filter(i => i.text)
        .slice(0, 200),
      fieldValues,
      comments: cardComments.slice(0, MAX_IMPORT_COMMENTS).map(m => ({
        authorName: commentName(m),
        body: m.data.text.trim().slice(0, 10_000),
        createdAt: m.date ?? null,
      })),
    })
  }
  // Comments on cards that are not in the export.
  for (const left of comments.values()) skipped.comments += left.length

  return {
    data: { name: clip(t.name, 100) || 'Trello board', columns: lists.map(l => ({ title: columnTitle.get(l.id)! })), tags, fields, cards },
    skipped,
    ignoredColumns: [],
  }
}
