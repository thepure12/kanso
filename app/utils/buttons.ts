// Helpers for board buttons (BoardButtonsModal, CardButtons, the board toolbar).
import type { BoardButtonStep, ButtonColor, ButtonScope, ButtonStep, ButtonStepKind, CardButtonStep } from '#shared/buttons'
import { boardStepKinds, cardStepKinds } from '#shared/buttons'

export const stepKindsFor = (scope: ButtonScope): readonly ButtonStepKind[] => scope === 'card' ? cardStepKinds : boardStepKinds

/** A new step of `kind` with empty references (filled in by the editor). */
export function blankStep(kind: ButtonStepKind): ButtonStep {
  switch (kind) {
    case 'move': return { kind, columnId: '' }
    case 'addTag':
    case 'removeTag': return { kind, tagId: '' }
    case 'assign': return { kind, userId: '' }
    case 'setDue': return { kind, inDays: 0 }
    case 'setPriority': return { kind, priority: 'high' }
    case 'addChecklist': return { kind, items: [] }
    case 'archiveColumn': return { kind, columnId: '' }
    case 'sortColumn': return { kind, columnId: '', by: 'priority' }
    case 'moveColumnCards': return { kind, from: '', to: '' }
    case 'assignMe':
    case 'unassignMe':
    case 'archive':
    case 'watch': return { kind }
  }
}

/** Whether the step has everything the server needs. */
export function stepComplete(step: ButtonStep): boolean {
  switch (step.kind) {
    case 'move':
    case 'archiveColumn':
    case 'sortColumn': return !!step.columnId
    case 'addTag':
    case 'removeTag': return !!step.tagId
    case 'assign': return !!step.userId
    case 'addChecklist': return step.items.some(i => i.trim())
    case 'moveColumnCards': return !!step.from && !!step.to && step.from !== step.to
    case 'setDue': return step.inDays === null || (Number.isInteger(step.inDays) && step.inDays >= 0 && step.inDays <= 3650)
    default: return true
  }
}

/** The step as sent to the server: trimmed checklist items. */
export function cleanStep(step: ButtonStep): ButtonStep {
  return step.kind === 'addChecklist' ? { ...step, items: step.items.map(i => i.trim()).filter(Boolean) } : step
}

export interface StepNames {
  t: (key: string, named?: Record<string, unknown>, plural?: number) => string
  column: (id: string) => string | undefined
  tag: (id: string) => string | undefined
  person: (id: string) => string | undefined
}

/** One line describing a step, e.g. "Move to Done"; gone references show as "?". */
export function describeStep(step: CardButtonStep | BoardButtonStep, n: StepNames): string {
  const { t } = n
  const gone = t('buttons.gone')
  switch (step.kind) {
    case 'move': return t('buttons.describe.move', { column: n.column(step.columnId) ?? gone })
    case 'addTag': return t('buttons.describe.addTag', { tag: n.tag(step.tagId) ?? gone })
    case 'removeTag': return t('buttons.describe.removeTag', { tag: n.tag(step.tagId) ?? gone })
    case 'assign': return t('buttons.describe.assign', { name: n.person(step.userId) ?? gone })
    case 'setDue': return step.inDays === null
      ? t('buttons.describe.clearDue')
      : t('buttons.describe.setDue', { n: step.inDays }, step.inDays)
    case 'setPriority': return step.priority === null
      ? t('buttons.describe.clearPriority')
      : t('buttons.describe.setPriority', { priority: t(`priority.${step.priority}`) })
    case 'addChecklist': return t('buttons.describe.addChecklist', { n: step.items.length }, step.items.length)
    case 'archiveColumn': return t('buttons.describe.archiveColumn', { column: n.column(step.columnId) ?? gone })
    case 'sortColumn': return t('buttons.describe.sortColumn', { column: n.column(step.columnId) ?? gone, by: t(`buttons.sortBy.${step.by}`) })
    case 'moveColumnCards': return t('buttons.describe.moveColumnCards', { from: n.column(step.from) ?? gone, to: n.column(step.to) ?? gone })
    default: return t(`buttons.kinds.${step.kind}`)
  }
}

/** The colour as CSS: the board accent (`--ui-primary`) or the picked hex. */
export const buttonCssColor = (color: ButtonColor) => color === 'accent' ? 'var(--ui-primary)' : color

/**
 * Soft look of a button in its colour (tinted background, text in the colour, toned
 * towards the page text so light colours stay readable); pair with `buttonColorClass`.
 */
export const buttonColorStyle = (color: ButtonColor) => ({ '--btn': buttonCssColor(color) })
export const buttonColorClass = 'bg-[color-mix(in_oklab,var(--btn)_15%,transparent)] hover:bg-[color-mix(in_oklab,var(--btn)_24%,transparent)] text-[color-mix(in_oklab,var(--btn)_70%,var(--ui-text-highlighted))]'
