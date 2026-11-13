import { describe, expect, it } from 'vitest'
import { boardColors, colorPresets } from '../../app/utils/color'

describe('boardColors', () => {
  it('collects colours from every part of the board, most used first', () => {
    const colors = boardColors({
      tags: [{ color: '#112233' }, { color: '#AABBCC' }],
      columns: [{ color: '#aabbcc', outline: { color: 'accent' } }, { color: null, outline: { color: '#445566' } }],
      columnGroups: [{ color: null }, { color: '#778899' }],
      fields: [{ options: [{ color: '#aabbcc' }, { color: '#000001' }] }],
      columnOutline: { color: 'column' },
      background: { kind: 'color', value: '#0f766e' },
    })
    expect(colors).toEqual(['#aabbcc', '#112233', '#445566', '#778899', '#000001', '#0f766e'])
  })

  it('leaves out the presets, gradients and non-hex values', () => {
    expect(boardColors({
      tags: [{ color: colorPresets[0]! }, { color: colorPresets[1]!.toUpperCase() }],
      background: { kind: 'gradient', value: 'ocean' },
    })).toEqual([])
    expect(boardColors({ tags: [{ color: '#ef4444' }] }, [])).toEqual(['#ef4444'])
  })

  it('stops at the limit', () => {
    const tags = Array.from({ length: 20 }, (_, i) => ({ color: `#0000${i.toString(16).padStart(2, '0')}` }))
    expect(boardColors({ tags }, colorPresets, 5)).toHaveLength(5)
  })
})
