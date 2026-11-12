import { describe, expect, it } from 'vitest'
import { columnOutlineSchema, columnOutlineStyle, effectiveColumnOutline } from '#shared/columnOutline'

describe('columnOutlineStyle', () => {
  it('leaves the default ring alone when unset', () => {
    expect(columnOutlineStyle(null)).toBeNull()
    expect(columnOutlineStyle(undefined, true)).toBeNull()
  })

  it('draws the frame inside the column with the chosen colour and width', () => {
    expect(columnOutlineStyle({ color: '#ff0000', width: 3, glow: 0 })).toEqual({ outline: '3px solid #ff0000', outlineOffset: '-3px' })
    expect(columnOutlineStyle({ color: null, width: 1, glow: 0 })!.outline).toBe('1px solid var(--ui-border)')
  })

  it('follows the board accent and adds a glow', () => {
    const style = columnOutlineStyle({ color: 'accent', width: 2, glow: 3 })!
    expect(style.outline).toBe('2px solid var(--ui-primary)')
    expect(style.boxShadow).toBe('0 0 20px color-mix(in srgb, var(--ui-primary) 70%, transparent)')
  })

  it('uses the column colour, falling back to the border colour', () => {
    expect(columnOutlineStyle({ color: 'column', width: 2, glow: 0 }, false, '#123456')!.outline).toBe('2px solid #123456')
    expect(columnOutlineStyle({ color: 'column', width: 2, glow: 0 }, false, null)!.outline).toBe('2px solid var(--ui-border)')
  })

  it('turns the error colour over the WIP limit, keeping width and glow', () => {
    const style = columnOutlineStyle({ color: '#00ff00', width: 4, glow: 1 }, true)!
    expect(style.outline).toBe('4px solid var(--ui-error)')
    expect(style.boxShadow).toContain('var(--ui-error)')
  })
})

describe('effectiveColumnOutline', () => {
  it('prefers the column override, then the board default', () => {
    const board = { color: 'accent', width: 2, glow: 1 } as const
    const own = { color: '#ffffff', width: 4, glow: 0 } as const
    expect(effectiveColumnOutline({ outline: own }, board)).toBe(own)
    expect(effectiveColumnOutline({ outline: null }, board)).toBe(board)
    expect(effectiveColumnOutline({ outline: null }, null)).toBeNull()
  })
})

describe('columnOutlineSchema', () => {
  it('accepts the stored shapes and refuses others', () => {
    expect(columnOutlineSchema.safeParse({ color: 'accent', width: 1, glow: 0 }).success).toBe(true)
    expect(columnOutlineSchema.safeParse({ color: '#a1b2c3', width: 4, glow: 3 }).success).toBe(true)
    expect(columnOutlineSchema.safeParse({ color: null, width: 2, glow: 1 }).success).toBe(true)
    expect(columnOutlineSchema.safeParse({ color: 'column', width: 2, glow: 1 }).success).toBe(true)
    expect(columnOutlineSchema.safeParse({ color: '#A1B2C3', width: 1, glow: 0 }).success).toBe(false)
    expect(columnOutlineSchema.safeParse({ color: 'red', width: 1, glow: 0 }).success).toBe(false)
    expect(columnOutlineSchema.safeParse({ color: null, width: 5, glow: 0 }).success).toBe(false)
    expect(columnOutlineSchema.safeParse({ color: null, width: 1, glow: 4 }).success).toBe(false)
  })
})
