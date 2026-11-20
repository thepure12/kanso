import { describe, expect, it } from 'vitest'
import { emptyRule, normalizeRule, ruleColumnIds, ruleTagIds, ruleValid } from '../../app/utils/boardRules'

describe('board rule helpers', () => {
  it('needs an action, distinct add/remove tags and a due offset in range', () => {
    const r = emptyRule()
    expect(ruleValid(r)).toBe(false)
    r.actions.archive = true
    expect(ruleValid(r)).toBe(true)
    r.actions.addTagId = 'a'
    r.actions.removeTagId = 'a'
    expect(ruleValid(r)).toBe(false)
    r.actions.removeTagId = null
    r.actions.dueDays = 400
    expect(ruleValid(r)).toBe(false)
    r.actions.dueDays = 0
    expect(ruleValid(r)).toBe(true)
  })

  it('drops event filters the event cannot have', () => {
    const r = { ...emptyRule(), eventTagId: 't', eventUserId: 'u' }
    expect(normalizeRule(r)).toMatchObject({ eventTagId: null, eventUserId: null })
    expect(normalizeRule({ ...r, event: 'tag_added' })).toMatchObject({ eventTagId: 't', eventUserId: null })
    expect(normalizeRule({ ...r, event: 'assigned' })).toMatchObject({ eventTagId: null, eventUserId: 'u' })
  })

  it('lists the tags and columns a rule names', () => {
    const r = emptyRule()
    r.event = 'tag_added'
    r.eventTagId = 'e'
    r.conditions.tagId = 'c'
    r.conditions.columnId = 'col'
    r.actions.addTagId = 'a'
    r.actions.moveColumnId = 'm'
    expect(ruleTagIds(r)).toEqual(['e', 'c', 'a'])
    expect(ruleColumnIds(r)).toEqual(['col', 'm'])
  })
})
