import { describe, expect, it } from 'vitest'
import { boardStepKinds, buttonColorSchema, cardStepKinds, createButtonSchema, type ButtonStep } from '../../shared/buttons'
import { blankStep, buttonCssColor, cleanStep, describeStep, stepComplete, stepKindsFor } from '../../app/utils/buttons'
import { serverI18n } from '../../server/utils/i18n'

const { t } = serverI18n('en')
const names = {
  t,
  column: (id: string) => ({ c1: 'Doing', c2: 'Done' } as Record<string, string>)[id],
  tag: (id: string) => (id === 't1' ? 'Bug' : undefined),
  person: (id: string) => (id === 'u1' ? 'Ann' : undefined),
}

describe('button steps', () => {
  it('blank steps are incomplete until their references are filled in', () => {
    for (const kind of [...cardStepKinds, ...boardStepKinds]) {
      expect(blankStep(kind).kind).toBe(kind)
    }
    expect(stepComplete(blankStep('move'))).toBe(false)
    expect(stepComplete({ kind: 'move', columnId: 'c1' })).toBe(true)
    expect(stepComplete(blankStep('assignMe'))).toBe(true)
    expect(stepComplete({ kind: 'moveColumnCards', from: 'c1', to: 'c1' })).toBe(false)
    expect(stepComplete({ kind: 'addChecklist', items: [' ', ''] })).toBe(false)
    expect(stepComplete({ kind: 'setDue', inDays: null })).toBe(true)
    expect(stepComplete({ kind: 'setDue', inDays: -1 })).toBe(false)
    expect(stepKindsFor('board')).toEqual(boardStepKinds)
  })

  it('cleans checklist items', () => {
    expect(cleanStep({ kind: 'addChecklist', items: [' a ', '', 'b'] })).toEqual({ kind: 'addChecklist', items: ['a', 'b'] })
  })

  it('describes steps, marking gone references', () => {
    const steps: ButtonStep[] = [
      { kind: 'move', columnId: 'c2' },
      { kind: 'addTag', tagId: 'gone' },
      { kind: 'assign', userId: 'u1' },
      { kind: 'setDue', inDays: 1 },
      { kind: 'setPriority', priority: 'high' },
      { kind: 'addChecklist', items: ['a', 'b'] },
      { kind: 'assignMe' },
      { kind: 'sortColumn', columnId: 'c1', by: 'due' },
      { kind: 'moveColumnCards', from: 'c1', to: 'c2' },
    ]
    expect(steps.map(s => describeStep(s, names))).toEqual([
      'Move to Done', 'Add tag ?', 'Assign Ann', 'Due in 1 day', 'Priority High', 'Add 2 checklist items',
      'Assign me', 'Sort Doing by due date', 'Move all cards from Doing to Done',
    ])
  })

  it('checks steps against the scope', () => {
    const id = '00000000-0000-4000-8000-000000000000'
    expect(createButtonSchema.safeParse({ scope: 'card', name: 'x', steps: [{ kind: 'archive' }] }).success).toBe(true)
    expect(createButtonSchema.safeParse({ scope: 'card', name: 'x', steps: [{ kind: 'archiveColumn', columnId: id }] }).success).toBe(false)
    expect(createButtonSchema.safeParse({ scope: 'board', name: 'x', steps: [{ kind: 'moveColumnCards', from: id, to: id }] }).success).toBe(false)
    expect(createButtonSchema.safeParse({ scope: 'board', name: 'x', steps: [] }).success).toBe(false)
  })
})

describe('button colours', () => {
  it('accepts the board accent or a lower-case hex, defaulting to the accent', () => {
    expect(buttonColorSchema.safeParse('accent').success).toBe(true)
    expect(buttonColorSchema.safeParse('#22c55e').success).toBe(true)
    for (const bad of ['primary', '#22C55E', '#fff', 'var(--x)']) expect(buttonColorSchema.safeParse(bad).success).toBe(false)
    const parsed = createButtonSchema.parse({ scope: 'card', name: 'Go', steps: [{ kind: 'archive' }] })
    expect(parsed.color).toBe('accent')
  })

  it('maps the accent to the primary colour variable', () => {
    expect(buttonCssColor('accent')).toBe('var(--ui-primary)')
    expect(buttonCssColor('#22c55e')).toBe('#22c55e')
  })
})
