// Board accent colours: a Nuxt UI / Tailwind palette name that replaces the
// app's primary colour while the board is open. Stored in boards.accent
// (null = the app default); the check boards_accent_known mirrors this list.

export const boardAccents = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
] as const

export type BoardAccent = typeof boardAccents[number]

export function isBoardAccent(v: unknown): v is BoardAccent {
  return typeof v === 'string' && (boardAccents as readonly string[]).includes(v)
}
