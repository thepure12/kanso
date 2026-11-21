// Board buttons: named lists of steps run with one click, on a card (scope
// `card`) or on the board (scope `board`). Personal (board_buttons.user_id = the
// user) or shared on the board (user_id null). See 0117_board_buttons_rls.sql.
import { z } from 'zod'
import { priorities } from './types/board'

export const buttonScopes = ['card', 'board'] as const
export type ButtonScope = (typeof buttonScopes)[number]

/**
 * Button colour: 'accent' follows the board accent colour, else any #rrggbb from the
 * colour picker. Check board_buttons_color_shape mirrors it (0118).
 */
export type ButtonColor = 'accent' | `#${string}`
export const buttonColorSchema = z.union([z.literal('accent'), z.string().regex(/^#[0-9a-f]{6}$/)]) as z.ZodType<ButtonColor>

export const buttonIcons = [
  'i-lucide-zap', 'i-lucide-check', 'i-lucide-arrow-right', 'i-lucide-archive', 'i-lucide-tag', 'i-lucide-user-plus',
  'i-lucide-calendar', 'i-lucide-flag', 'i-lucide-list-checks', 'i-lucide-eye', 'i-lucide-rocket', 'i-lucide-star',
  'i-lucide-arrow-down-wide-narrow', 'i-lucide-play',
] as const

export const buttonSortKeys = ['priority', 'due', 'title'] as const

const id = z.uuid()

/** Steps of card buttons; they act on the card the button is run on. */
export const cardButtonStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), columnId: id }),
  z.object({ kind: z.literal('addTag'), tagId: id }),
  z.object({ kind: z.literal('removeTag'), tagId: id }),
  z.object({ kind: z.literal('assignMe') }),
  z.object({ kind: z.literal('unassignMe') }),
  z.object({ kind: z.literal('assign'), userId: id }),
  /** Due this many days from today; null clears the due date. */
  z.object({ kind: z.literal('setDue'), inDays: z.int().min(0).max(3650).nullable() }),
  z.object({ kind: z.literal('setPriority'), priority: z.enum(priorities).nullable() }),
  z.object({ kind: z.literal('addChecklist'), items: z.array(z.string().trim().min(1).max(500)).min(1).max(20) }),
  z.object({ kind: z.literal('archive') }),
  z.object({ kind: z.literal('watch') }),
])

/** Steps of board buttons. */
export const boardButtonStepSchema = z.discriminatedUnion('kind', [
  /** Archives every shown card of the column. */
  z.object({ kind: z.literal('archiveColumn'), columnId: id }),
  z.object({ kind: z.literal('sortColumn'), columnId: id, by: z.enum(buttonSortKeys) }),
  /** Moves every shown card of `from` to the end of `to`, so column rules run. */
  z.object({ kind: z.literal('moveColumnCards'), from: id, to: id }).refine(s => s.from !== s.to, 'Pick two different columns'),
])

export type CardButtonStep = z.infer<typeof cardButtonStepSchema>
export type BoardButtonStep = z.infer<typeof boardButtonStepSchema>
export type ButtonStep = CardButtonStep | BoardButtonStep
export type ButtonStepKind = ButtonStep['kind']

export const cardStepKinds = cardButtonStepSchema.options.map(o => o.shape.kind.value)
export const boardStepKinds = ['archiveColumn', 'sortColumn', 'moveColumnCards'] as const satisfies readonly BoardButtonStep['kind'][]

export const MAX_BUTTON_STEPS = 10

export const buttonName = z.string().trim().min(1).max(50)

/** Card buttons: the columns whose cards offer the button; null = every column. */
export const buttonColumnIds = z.array(id).min(1).max(100).nullable()

const appearance = {
  name: buttonName,
  icon: z.enum(buttonIcons).nullable().default(null),
  color: buttonColorSchema.default('accent'),
}

/** Body of POST /api/boards/:id/buttons. */
export const createButtonSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('card'), ...appearance, shared: z.boolean().default(false), columnIds: buttonColumnIds.default(null), steps: z.array(cardButtonStepSchema).min(1).max(MAX_BUTTON_STEPS) }),
  z.object({ scope: z.literal('board'), ...appearance, shared: z.boolean().default(false), steps: z.array(boardButtonStepSchema).min(1).max(MAX_BUTTON_STEPS) }),
])

/** Steps checked against the button's scope (PATCH). */
export function stepsSchema(scope: ButtonScope) {
  return z.array(scope === 'card' ? cardButtonStepSchema : boardButtonStepSchema).min(1).max(MAX_BUTTON_STEPS)
}

export interface BoardButton {
  id: string
  scope: ButtonScope
  name: string
  icon: string | null
  color: ButtonColor
  /** Shared on the board; false = only the current user sees it. */
  shared: boolean
  /**
   * Card buttons: offered only on cards in these columns; null = every column
   * (always null for board buttons). Empty once all its columns were deleted.
   */
  columnIds: string[] | null
  steps: ButtonStep[]
}

/** Whether a card button is offered on a card in `columnId`. */
export function buttonShownIn(button: Pick<BoardButton, 'columnIds'>, columnId: string): boolean {
  return button.columnIds === null || button.columnIds.includes(columnId)
}

/** Response of POST /api/buttons/:id/run. */
export interface ButtonRunResult {
  /** Steps left out because their column, tag or person is gone. */
  skipped: number
}
