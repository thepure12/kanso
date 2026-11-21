import { beforeAll, describe, expect, it, vi } from 'vitest'
import { isNameTaken } from '../../app/utils/nameTaken'

// toHttpError uses Nitro's auto-imported createError.
let toHttpError: (err: unknown) => never
beforeAll(async () => {
  vi.stubGlobal('createError', (e: { statusCode: number, statusMessage: string, data?: unknown }) => Object.assign(new Error(e.statusMessage), e))
  ;({ toHttpError } = await import('../../server/utils/errors'))
})

function mapped(code: string, constraint?: string) {
  try {
    toHttpError({ code, constraint_name: constraint })
  }
  catch (e) {
    return e as { statusCode: number, statusMessage: string, data?: { problem?: string } }
  }
  throw new Error('not thrown')
}

describe('toHttpError', () => {
  it('marks only name unique violations as nameTaken', () => {
    expect(mapped('23505', 'board_buttons_name_unique')).toMatchObject({ statusCode: 409, data: { problem: 'nameTaken' } })
    expect(mapped('23505', 'tags_board_id_name_unique').data?.problem).toBe('nameTaken')
    expect(mapped('23505', 'column_rules_one_due_per_column')).toMatchObject({ statusCode: 409 })
    expect(mapped('23505', 'column_rules_one_due_per_column').data?.problem).toBeUndefined()
  })

  it('maps unknown check constraints to 400, the last-owner triggers to 409', () => {
    expect(mapped('23514', 'board_buttons_color_shape')).toMatchObject({ statusCode: 400, statusMessage: 'Invalid value' })
    expect(mapped('23514')).toMatchObject({ statusCode: 409, statusMessage: 'There must be at least one owner left' })
    expect(mapped('23514', 'cards_start_before_due').statusCode).toBe(400)
  })
})

describe('isNameTaken', () => {
  it('reads data.problem of a fetch error', () => {
    expect(isNameTaken({ statusCode: 409, data: { statusCode: 409, data: { problem: 'nameTaken' } } })).toBe(true)
    expect(isNameTaken({ statusCode: 409, data: { statusCode: 409, statusMessage: 'There must be at least one owner left' } })).toBe(false)
    expect(isNameTaken({ statusCode: 400, data: { statusMessage: 'Invalid value' } })).toBe(false)
    expect(isNameTaken(null)).toBe(false)
  })
})
