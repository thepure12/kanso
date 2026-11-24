/**
 * Emoji stickers editors can put on a card's front. Check `cards_stickers_known`
 * (schema.ts) mirrors this list; add to both (a new migration regenerates the check).
 */
export const stickerEmojis = [
  '⭐', '🔥', '🎉', '🚀', '💡', '🎯', '🏆', '✅',
  '❗', '❓', '⚠️', '🐛', '🔒', '📌', '💰', '⏳',
  '❤️', '👍', '👀', '😄', '😎', '🤔', '🙏', '☕',
  '🌱', '🍀', '🦄', '🐢',
] as const

export type StickerEmoji = typeof stickerEmojis[number]

/** At most this many stickers on one card (check `cards_stickers_known`). */
export const STICKERS_MAX = 8

export const isStickerEmoji = (v: unknown): v is StickerEmoji =>
  typeof v === 'string' && (stickerEmojis as readonly string[]).includes(v)

/** Adds the sticker, or removes it when the card already has it; null when the card is full. */
export function toggleSticker(stickers: readonly string[], emoji: StickerEmoji): string[] | null {
  if (stickers.includes(emoji)) return stickers.filter(s => s !== emoji)
  if (stickers.length >= STICKERS_MAX) return null
  return [...stickers, emoji]
}
