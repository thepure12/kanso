import { and, asc, eq, sql } from 'drizzle-orm'
import { buttonShownOn, type BoardButton, type BoardButtonStep, type ButtonStep, type CardButtonStep } from '#shared/buttons'

const { boardButtons: bb, boardButtonCards: bbc } = schema

const buttonFields = {
  id: bb.id, scope: bb.scope, name: bb.name, icon: bb.icon, color: bb.color, tooltip: bb.tooltip,
  shared: sql<boolean>`${bb.userId} is null`, columnIds: bb.columnIds,
  // Cards it was added to that the user sees (RLS on board_button_cards and cards).
  cardIds: sql<string[]>`coalesce((select array_agg(${bbc.cardId} order by ${bbc.cardId}) from ${bbc} where ${bbc.buttonId} = ${bb.id}), '{}')`,
  steps: bb.steps,
}

/** Shared buttons and the user's own (RLS hides other people's), by name. */
export function loadButtons(tx: Tx, boardId: string): Promise<BoardButton[]> {
  return tx.select(buttonFields).from(bb).where(eq(bb.boardId, boardId))
    .orderBy(asc(sql`lower(${bb.name})`), asc(bb.createdAt))
}

/** One button, or null when it is gone or not visible. */
export async function loadButton(tx: Tx, id: string): Promise<(BoardButton & { boardId: string }) | null> {
  const [row] = await tx.select({ ...buttonFields, boardId: bb.boardId }).from(bb).where(eq(bb.id, id))
  return row ?? null
}

function forbidden(): never {
  throw createError({ statusCode: 403, statusMessage: 'You do not have permission to do that' })
}

async function columnOnBoard(tx: Tx, boardId: string, columnId: string) {
  const rows = await tx.select({ id: schema.columns.id }).from(schema.columns)
    .where(and(eq(schema.columns.id, columnId), eq(schema.columns.boardId, boardId)))
  return rows.length > 0
}

async function tagOnBoard(tx: Tx, boardId: string, tagId: string) {
  const rows = await tx.select({ id: schema.tags.id }).from(schema.tags)
    .where(and(eq(schema.tags.id, tagId), eq(schema.tags.boardId, boardId)))
  return rows.length > 0
}

async function personOnBoard(tx: Tx, boardId: string, userId: string) {
  const rows = await tx.execute(sql`select 1 from app.board_people(${boardId}) p where p.user_id = ${userId}`)
  return rows.length > 0
}

/** Runs one card step. Returns false when it was skipped (its column, tag or person is gone). */
async function runCardStep(tx: Tx, boardId: string, cardId: string, step: CardButtonStep): Promise<boolean> {
  const { cards, cardTags, cardAssignees, cardWatchers, checklistItems, checklists } = schema
  const card = eq(cards.id, cardId)
  switch (step.kind) {
    case 'move': {
      if (!await columnOnBoard(tx, boardId, step.columnId)) return false
      const [current] = await tx.select({ columnId: cards.columnId }).from(cards).where(card)
      if (current?.columnId === step.columnId) return true
      const position = await endPosition(tx, 'card', step.columnId)
      // Column rules run (triggers); a limited member's move into a non-edit column is refused (42501).
      const rows = await tx.update(cards).set({ columnId: step.columnId, position }).where(card).returning({ id: cards.id })
      if (!rows.length) forbidden()
      return true
    }
    case 'addTag':
      if (!await tagOnBoard(tx, boardId, step.tagId)) return false
      await tx.insert(cardTags).values({ cardId, tagId: step.tagId, boardId }).onConflictDoNothing()
      return true
    case 'removeTag':
      if (!await tagOnBoard(tx, boardId, step.tagId)) return false
      await tx.delete(cardTags).where(and(eq(cardTags.cardId, cardId), eq(cardTags.tagId, step.tagId)))
      return true
    case 'assignMe':
      await tx.insert(cardAssignees).values({ cardId, boardId, userId: sql`app.current_user_id()` }).onConflictDoNothing()
      return true
    case 'unassignMe':
      await tx.delete(cardAssignees).where(and(eq(cardAssignees.cardId, cardId), sql`${cardAssignees.userId} = app.current_user_id()`))
      return true
    case 'assign':
      if (!await personOnBoard(tx, boardId, step.userId)) return false
      await tx.insert(cardAssignees).values({ cardId, boardId, userId: step.userId }).onConflictDoNothing()
      return true
    case 'setDue': {
      const due = step.inDays === null ? null : sql`current_date + ${step.inDays}::int`
      // A start after the new due date moves back to it, like a set_due column rule.
      await tx.update(cards).set(due === null
        ? { dueDate: null }
        : { dueDate: due, startDate: sql`case when ${cards.startDate} > ${due} then ${due} else ${cards.startDate} end` }).where(card)
      return true
    }
    case 'setPriority':
      await tx.update(cards).set({ priority: step.priority }).where(card)
      return true
    case 'addChecklist': {
      // Into the card's first checklist, like POST /api/cards/:id/checklist without checklistId.
      const [first] = await tx.select({ id: checklists.id }).from(checklists).where(eq(checklists.cardId, cardId))
        .orderBy(asc(checklists.position), asc(checklists.createdAt), asc(checklists.id)).limit(1)
      const checklistId = first?.id
        ?? (await tx.insert(checklists).values({ cardId, boardId, name: 'Checklist', position: 1024 }).returning({ id: checklists.id }))[0]!.id
      let position = await endPosition(tx, 'checklistItem', checklistId)
      for (const text of step.items) {
        await tx.insert(checklistItems).values({ cardId, boardId, checklistId, text, position })
        position += 1024
      }
      return true
    }
    case 'archive':
      await tx.update(cards).set({ archivedAt: sql`coalesce(${cards.archivedAt}, now())` }).where(card)
      return true
    case 'watch':
      await tx.insert(cardWatchers).values({ cardId, boardId, userId: sql`app.current_user_id()` }).onConflictDoNothing()
      return true
  }
}

/** Shown cards of a column: not archived, snoozed, trashed (RLS) or templates. */
const shownIn = (columnId: string) => sql`column_id = ${columnId} and archived_at is null and snoozed_until is null and not is_template`

const sortOrder = {
  priority: sql`case priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end, position`,
  due: sql`due_date nulls last, position`,
  title: sql`lower(title), position`,
}

/** Runs one board step. Every card it touches must be editable by the user, else 403. */
async function runBoardStep(tx: Tx, boardId: string, step: BoardButtonStep): Promise<boolean> {
  switch (step.kind) {
    case 'archiveColumn': {
      if (!await columnOnBoard(tx, boardId, step.columnId)) return false
      const [res] = await tx.execute<{ total: number, done: number }>(sql`
        with t as (select id from cards where ${shownIn(step.columnId)}),
             u as (update cards c set archived_at = now() from t where c.id = t.id returning c.id)
        select (select count(*) from t)::int as total, (select count(*) from u)::int as done`)
      if (res!.total !== res!.done) forbidden()
      return true
    }
    case 'sortColumn': {
      if (!await columnOnBoard(tx, boardId, step.columnId)) return false
      const [res] = await tx.execute<{ total: number, done: number }>(sql`
        with t as (select id, row_number() over (order by ${sortOrder[step.by]}) as ord from cards where ${shownIn(step.columnId)}),
             u as (update cards c set position = t.ord * 1024 from t where c.id = t.id returning c.id)
        select (select count(*) from t)::int as total, (select count(*) from u)::int as done`)
      if (res!.total !== res!.done) forbidden()
      return true
    }
    case 'moveColumnCards': {
      if (!await columnOnBoard(tx, boardId, step.from) || !await columnOnBoard(tx, boardId, step.to)) return false
      const moving = await tx.execute<{ id: string }>(sql`select id from cards where ${shownIn(step.from)} order by position`)
      let position = await endPosition(tx, 'card', step.to)
      // One by one, so each card's column rules run (triggers).
      for (const { id } of moving) {
        const rows = await tx.update(schema.cards).set({ columnId: step.to, position }).where(eq(schema.cards.id, id)).returning({ id: schema.cards.id })
        if (!rows.length) forbidden()
        position += 1024
      }
      return true
    }
  }
}

/**
 * Runs a button's steps in order, in the caller's transaction, so a refused
 * step undoes all of them. Card buttons need `cardId` (a card of the button's
 * board the user can edit). Returns how many steps were skipped.
 */
export async function runButton(tx: Tx, button: { boardId: string, scope: string, columnIds: string[] | null, cardIds: string[], steps: ButtonStep[] }, cardId: string | undefined): Promise<number> {
  let skipped = 0
  if (button.scope === 'card') {
    if (!cardId) throw createError({ statusCode: 400, statusMessage: 'cardId: Required for a card button' })
    const { cards } = schema
    // Touches the card first, so edit rights (RLS) are proven before any step.
    const rows = await tx.update(cards).set({ updatedAt: sql`now()` })
      .where(and(eq(cards.id, cardId), eq(cards.boardId, button.boardId), eq(cards.isTemplate, false)))
      .returning({ id: cards.id, columnId: cards.columnId })
    if (!rows.length) notFound('Card not found or not allowed')
    if (!buttonShownOn(button, { id: cardId, columnId: rows[0]!.columnId })) {
      throw createError({ statusCode: 409, statusMessage: 'This button is not offered on this card' })
    }
    for (const step of button.steps as CardButtonStep[]) {
      if (!await runCardStep(tx, button.boardId, cardId, step)) skipped++
    }
  }
  else {
    for (const step of button.steps as BoardButtonStep[]) {
      if (!await runBoardStep(tx, button.boardId, step)) skipped++
    }
  }
  return skipped
}

/**
 * Adds a card button to one card (or removes it): the card then offers it
 * whatever the button's columns. RLS decides: own personal buttons, or shared
 * ones for editors of the card. Returns the button as the user now sees it.
 */
export async function setButtonOnCard(tx: Tx, buttonId: string, cardId: string, on: boolean): Promise<BoardButton> {
  const button = await loadButton(tx, buttonId)
  if (!button) notFound('Button not found')
  if (button.scope !== 'card') throw createError({ statusCode: 400, statusMessage: 'Only card buttons can be added to cards' })
  if (on) {
    const [card] = await tx.select({ id: schema.cards.id }).from(schema.cards)
      .where(and(eq(schema.cards.id, cardId), eq(schema.cards.boardId, button.boardId), eq(schema.cards.isTemplate, false)))
    if (!card) notFound('Card not found')
    // Already added: nothing to do. A refused insert raises 42501 -> 403.
    await tx.insert(bbc).values({ buttonId, cardId, boardId: button.boardId }).onConflictDoNothing()
  }
  else {
    const rows = await tx.delete(bbc).where(and(eq(bbc.buttonId, buttonId), eq(bbc.cardId, cardId))).returning({ id: bbc.cardId })
    if (!rows.length && button.cardIds.includes(cardId)) forbidden()
  }
  return (await loadButton(tx, buttonId))!
}
