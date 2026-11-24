// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRAG_COUNT_ATTR, DRAG_STACK_PAD, dragImageOffset, setStackDragImage } from '../../app/utils/dragStack'

const rect = { left: 100, top: 50, width: 200, height: 80 }

describe('dragImageOffset', () => {
  it('holds the picture where the card was grabbed, past the padding', () => {
    expect(dragImageOffset(rect, { x: 130, y: 60 })).toEqual({ x: 30 + DRAG_STACK_PAD, y: 10 + DRAG_STACK_PAD })
  })
  it('keeps the grab point inside the card', () => {
    expect(dragImageOffset(rect, { x: 0, y: 500 }, 0)).toEqual({ x: 0, y: 80 })
  })
  it('uses the middle without a pointer', () => {
    expect(dragImageOffset(rect, null, 0)).toEqual({ x: 100, y: 40 })
  })
})

describe('setStackDragImage', () => {
  afterEach(() => { vi.useRealTimers() })

  it('draws a copy of the card with the group size and removes it afterwards', () => {
    vi.useFakeTimers()
    const card = document.createElement('div')
    card.id = 'card'
    card.textContent = 'Title'
    card.getBoundingClientRect = () => ({ ...rect, right: 300, bottom: 130, x: 100, y: 50, toJSON: () => ({}) })
    document.body.appendChild(card)
    const setDragImage = vi.fn()

    const wrap = setStackDragImage({ setDragImage }, card, 3, { x: 110, y: 70 })

    const copy = wrap.firstElementChild as HTMLElement
    expect(copy.textContent).toBe('Title')
    expect(copy.id).toBe('')
    expect(copy.classList.contains('drag-stack')).toBe(true)
    expect(copy.getAttribute(DRAG_COUNT_ATTR)).toBe('3')
    expect(card.hasAttribute(DRAG_COUNT_ATTR)).toBe(false)
    expect(setDragImage).toHaveBeenCalledWith(wrap, 10 + DRAG_STACK_PAD, 20 + DRAG_STACK_PAD)
    expect(wrap.isConnected).toBe(true)
    vi.runAllTimers()
    expect(wrap.isConnected).toBe(false)
  })
})
