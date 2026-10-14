import { asc, desc, eq, sql } from 'drizzle-orm'
import type { Activity, CardDetail, FieldValue } from '#shared/types/board'

export default defineUserHandler(async (event, tx, userId): Promise<CardDetail> => {
  const { id } = await paramsValidated(event, uuidParam)
  await cardBoardId(tx, id)
  const { checklistItems: ci, cardComments: cc, cardAttachments: ca, cardActivity: act, cardWatchers: cw, cardFieldValues: fv, users } = schema

  // users rows are visible only while the person shares a board or team with the caller.
  const [checklist, comments, attachments, activity, timeEntries, watcherRows, links, fieldRows] = await Promise.all([
    tx.select({ id: ci.id, text: ci.text, done: ci.done, position: ci.position })
      .from(ci).where(eq(ci.cardId, id)).orderBy(asc(ci.position)),
    tx.select({
      id: cc.id, authorId: cc.authorId, authorName: users.name, authorAvatarUrl: users.avatarUrl,
      body: cc.body, createdAt: cc.createdAt, updatedAt: cc.updatedAt,
    }).from(cc).leftJoin(users, eq(users.id, cc.authorId)).where(eq(cc.cardId, id)).orderBy(asc(cc.createdAt)),
    tx.select({ id: ca.id, name: ca.name, contentType: ca.contentType, size: ca.size, uploadedBy: ca.uploadedBy, createdAt: ca.createdAt })
      .from(ca).where(eq(ca.cardId, id)).orderBy(asc(ca.createdAt)),
    tx.select({ id: act.id, actorId: act.actorId, actorName: users.name, kind: act.kind, data: act.data, createdAt: act.createdAt })
      .from(act).leftJoin(users, eq(users.id, act.actorId)).where(eq(act.cardId, id)).orderBy(desc(act.createdAt)).limit(100),
    loadTimeEntries(tx, sql`te.card_id = ${id}`),
    tx.select({ userId: cw.userId, name: users.name, avatarUrl: users.avatarUrl })
      .from(cw).leftJoin(users, eq(users.id, cw.userId)).where(eq(cw.cardId, id)).orderBy(asc(cw.createdAt)),
    loadCardLinks(tx, sql`l.card_id = ${id}`),
    tx.select({ fieldId: fv.fieldId, value: fv.value }).from(fv).where(eq(fv.cardId, id)),
  ])

  const iso = (d: Date) => d.toISOString()
  return {
    checklist,
    comments: comments.map(c => ({ ...c, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt) })),
    attachments: attachments.map(a => ({ ...a, createdAt: iso(a.createdAt) })),
    activity: activity.map(a => ({ ...a, kind: a.kind as Activity['kind'], data: a.data as Activity['data'], createdAt: iso(a.createdAt) })),
    timeEntries,
    timeTotal: timeEntries.reduce((sum, e) => sum + e.minutes, 0),
    watchers: watcherRows.flatMap(w => w.name === null ? [] : [{ ...w, name: w.name }]),
    watching: watcherRows.some(w => w.userId === userId),
    links,
    fields: Object.fromEntries(fieldRows.map(f => [f.fieldId, f.value as FieldValue])),
  }
})
