// Board backgrounds: a plain colour, a preset gradient, a stock photo or an
// uploaded image. Stored in boards.background; the uploaded image itself lives
// in board_backgrounds and is served by GET /api/boards/:id/background.
// The Kanso logo background is stored as gradient `kanso` (no schema change):
// the app's glyph over a gradient in the board's accent colour.

import colors from 'tailwindcss/colors'
import type { BoardAccent } from './boardAccents'

export type BoardBackground =
  | { kind: 'color', value: string }
  | { kind: 'gradient', value: string }
  | { kind: 'photo', value: string }
  /** `value` is a version token that changes with each upload (cache busting). */
  | { kind: 'upload', value: string }

/** Suggested colours; any lower-case #rrggbb is allowed. */
export const backgroundColors = [
  '#0f766e', '#0369a1', '#1d4ed8', '#6d28d9', '#a21caf',
  '#be123c', '#c2410c', '#a16207', '#4d7c0f', '#334155',
] as const

export const backgroundGradients = [
  { id: 'ocean', css: 'linear-gradient(135deg, #0ea5e9 0%, #1e3a8a 100%)' },
  { id: 'sunset', css: 'linear-gradient(135deg, #f97316 0%, #db2777 55%, #7c3aed 100%)' },
  { id: 'forest', css: 'linear-gradient(135deg, #22c55e 0%, #0f766e 100%)' },
  { id: 'peach', css: 'linear-gradient(135deg, #fde68a 0%, #fb923c 100%)' },
  { id: 'aurora', css: 'linear-gradient(135deg, #2dd4bf 0%, #6366f1 50%, #a855f7 100%)' },
  { id: 'berry', css: 'linear-gradient(135deg, #f43f5e 0%, #7e22ce 100%)' },
  { id: 'slate', css: 'linear-gradient(135deg, #64748b 0%, #0f172a 100%)' },
  { id: 'dawn', css: 'linear-gradient(135deg, #fbcfe8 0%, #a5b4fc 100%)' },
] as const

/** Gradient id of the Kanso logo background, drawn in the board's accent colour. */
export const logoBackgroundId = 'kanso'

// The app glyph (three bars, as in public/favicon.svg), white and faint.
const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="#fff" stroke-opacity=".22" '
  + 'stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v14m7-14v8m7-8v18"/></svg>'

/**
 * CSS for the Kanso logo background: `accent` null = the app's primary colour (CSS variables).
 * `large` is the board page: the glyph stays in the middle of the window while the board scrolls.
 */
export function logoBackgroundStyle(accent: BoardAccent | null | undefined, large = false): Record<string, string> {
  const shade = (n: 400 | 600 | 900) => accent && colors[accent] ? colors[accent][n] : `var(--ui-color-primary-${n})`
  return {
    backgroundColor: shade(600),
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(logoSvg)}"), linear-gradient(135deg, ${shade(400)} 0%, ${shade(600)} 50%, ${shade(900)} 100%)`,
    backgroundRepeat: 'no-repeat, no-repeat',
    backgroundPosition: 'center, center',
    backgroundSize: large ? 'auto 50vmin, cover' : 'auto 60%, cover',
    ...(large && { backgroundAttachment: 'fixed, scroll' }),
  }
}

// Stock photos in public/backgrounds (<id>.jpg 1920×1080, <id>-thumb.jpg 320×200).
// From Unsplash (unsplash.com/license: free to use, no attribution required).
export const backgroundPhotos = [
  { id: 'alps' },
  { id: 'beach' },
  { id: 'forest' },
  { id: 'highlands' },
  { id: 'lake' },
  { id: 'night' },
  { id: 'city' },
  { id: 'desert' },
] as const

/** Whether `bg` is a hex colour or a gradient or photo the app offers. Uploads are not checked here. */
export function isPresetBackground(bg: BoardBackground): boolean {
  switch (bg.kind) {
    case 'color': return /^#[0-9a-f]{6}$/.test(bg.value)
    case 'gradient': return bg.value === logoBackgroundId || backgroundGradients.some(g => g.id === bg.value)
    case 'photo': return backgroundPhotos.some(p => p.id === bg.value)
    case 'upload': return false
  }
}

/**
 * CSS for an element showing the background of board `boardId`, or undefined when plain.
 * `base` is the app's base path ('' at the root; basePath() in the app); `accent` is the
 * board's accent, which colours the Kanso logo background.
 */
export function backgroundStyle(
  bg: BoardBackground | null | undefined, boardId: string, thumb = false, base = '', accent: BoardAccent | null = null,
): Record<string, string> | undefined {
  if (!bg) return undefined
  switch (bg.kind) {
    case 'color':
      return { backgroundColor: bg.value }
    case 'gradient': {
      if (bg.value === logoBackgroundId) return logoBackgroundStyle(accent, !thumb)
      const g = backgroundGradients.find(g => g.id === bg.value)
      return g ? { backgroundImage: g.css } : undefined
    }
    case 'photo':
      return backgroundPhotos.some(p => p.id === bg.value)
        ? imageStyle(`${base}/backgrounds/${bg.value}${thumb ? '-thumb' : ''}.jpg`)
        : undefined
    case 'upload':
      return imageStyle(`${base}/api/boards/${boardId}/background?v=${encodeURIComponent(bg.value)}`)
  }
}

function imageStyle(url: string) {
  return { backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
}
