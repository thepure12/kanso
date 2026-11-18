import { describe, expect, it } from 'vitest'
import { focusDirection, neighbourCard, type CardBox } from '../../app/utils/cardFocus'

// Three columns 280 px wide, 16 px apart; cards 80 px high, 8 px apart.
const box = (id: string, col: number, row: number, width = 280): CardBox =>
  ({ id, left: col * 296, top: 100 + row * 88, width, height: 80 })
const boxes = [
  box('a0', 0, 0), box('a1', 0, 1), box('a2', 0, 2),
  // second column is empty
  box('c0', 2, 0), box('c1', 2, 1),
]
const at = (id: string) => boxes.find(b => b.id === id)!

describe('focusDirection', () => {
  it('maps arrows and h j k l', () => {
    expect(['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'h', 'j', 'k', 'l', 'x'].map(focusDirection))
      .toEqual(['left', 'down', 'up', 'right', 'left', 'down', 'up', 'right', null])
  })
})

describe('neighbourCard', () => {
  it('moves up and down within the column, stopping at its ends', () => {
    expect(neighbourCard(at('a0'), boxes, 'down')).toBe('a1')
    expect(neighbourCard(at('a1'), boxes, 'up')).toBe('a0')
    expect(neighbourCard(at('a2'), boxes, 'down')).toBeNull()
    expect(neighbourCard(at('a0'), boxes, 'up')).toBeNull()
  })

  it('skips empty columns and keeps the nearest height', () => {
    expect(neighbourCard(at('a1'), boxes, 'right')).toBe('c1')
    expect(neighbourCard(at('a2'), boxes, 'right')).toBe('c1')
    expect(neighbourCard(at('c0'), boxes, 'left')).toBe('a0')
    expect(neighbourCard(at('c0'), boxes, 'right')).toBeNull()
    expect(neighbourCard(at('a0'), boxes, 'left')).toBeNull()
  })

  it('handles columns of different widths', () => {
    const wide = [box('a', 0, 0, 400), { ...box('b', 0, 0, 220), left: 416 }, { ...box('c', 0, 0, 220), left: 652 }]
    expect(neighbourCard(wide[0]!, wide, 'right')).toBe('b')
    expect(neighbourCard(wide[1]!, wide, 'right')).toBe('c')
    expect(neighbourCard(wide[2]!, wide, 'left')).toBe('b')
  })

  it('goes down into the next swimlane of the same column', () => {
    const lanes = [box('l1', 0, 0), box('l2', 0, 4), box('other', 1, 1)]
    expect(neighbourCard(lanes[0]!, lanes, 'down')).toBe('l2')
  })
})
