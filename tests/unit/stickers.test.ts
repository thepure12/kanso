import { describe, expect, it } from 'vitest'
import { STICKERS_MAX, isStickerEmoji, stickerEmojis, toggleSticker } from '../../shared/stickers'

describe('stickers', () => {
  it('knows its emoji', () => {
    expect(new Set(stickerEmojis).size).toBe(stickerEmojis.length)
    expect(isStickerEmoji('🔥')).toBe(true)
    expect(isStickerEmoji('🥔')).toBe(false)
    expect(isStickerEmoji(1)).toBe(false)
  })

  it('adds at the end, removes when present, refuses past the limit', () => {
    expect(toggleSticker([], '🔥')).toEqual(['🔥'])
    expect(toggleSticker(['🔥', '⭐'], '🔥')).toEqual(['⭐'])
    const full = stickerEmojis.slice(0, STICKERS_MAX)
    expect(toggleSticker(full, stickerEmojis[STICKERS_MAX]!)).toBeNull()
    expect(toggleSticker(full, full[0]!)).toHaveLength(STICKERS_MAX - 1)
  })
})
