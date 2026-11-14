/**
 * Emoji people can react to a comment with. Check `comment_reactions_emoji_known`
 * (migration 0072) mirrors this list; add to both.
 */
export const reactionEmojis = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'] as const

export type ReactionEmoji = typeof reactionEmojis[number]

export const isReactionEmoji = (v: unknown): v is ReactionEmoji =>
  typeof v === 'string' && (reactionEmojis as readonly string[]).includes(v)
