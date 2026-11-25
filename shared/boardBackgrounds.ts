// Board backgrounds: a plain colour, a preset gradient, a stock photo or an
// uploaded image. Stored in boards.background; the uploaded image itself lives
// in board_backgrounds and is served by GET /api/boards/:id/background.
// Colours and gradients may add `logo: true`: the app's glyph in the board's
// accent colour on top (an extra JSON key, so no schema change).

import colors from 'tailwindcss/colors'
import { z } from 'zod'
import { type BoardAccent, defaultAccent } from './boardAccents'

export type BoardBackground =
  | { kind: 'color', value: string, logo?: boolean }
  | { kind: 'gradient', value: string, logo?: boolean }
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

/** Whether `bg` can carry the Kanso logo (plain colours and gradients). */
export function canShowLogo(bg: BoardBackground | null | undefined): bg is Extract<BoardBackground, { kind: 'color' | 'gradient' }> {
  return bg?.kind === 'color' || bg?.kind === 'gradient'
}

/** Whether `bg` is a hex colour or a gradient or photo the app offers. Uploads are not checked here. */
export function isPresetBackground(bg: BoardBackground): boolean {
  switch (bg.kind) {
    case 'color': return /^#[0-9a-f]{6}$/.test(bg.value)
    case 'gradient': return backgroundGradients.some(g => g.id === bg.value)
    case 'photo': return backgroundPhotos.some(p => p.id === bg.value)
    case 'upload': return false
  }
}

/**
 * A colour, gradient or stock photo as sent by the client (PUT /api/boards/:id/background,
 * PATCH /api/views/:id); uploads go through their own POST routes.
 */
export const presetBackgroundSchema = z.object({
  kind: z.enum(['color', 'gradient', 'photo']),
  value: z.string().max(40),
  // The Kanso logo on top: colours and gradients only.
  logo: z.boolean().optional(),
}).refine(bg => isPresetBackground(bg), 'Unknown background')
  .refine(bg => !bg.logo || bg.kind !== 'photo', 'logo: Only on colours and gradients')
  // Drop `logo: false` so stored backgrounds carry the key only when on.
  .transform(({ logo, ...bg }) => (logo ? { ...bg, logo } : bg) as BoardBackground)

// The app glyph (three bars, as in public/favicon.svg) in `colour`, slightly see-through.
function logoSvg(colour: string) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" '
    + `stroke="${colour}" stroke-opacity=".6" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" `
    + 'd="M5 3v14m7-14v8m7-8v18"/></svg>'
}

/** The Kanso logo as a CSS image in the board's accent colour (null = the app default, `defaultAccent`). */
export function logoImage(accent: BoardAccent | null | undefined): string {
  return `url("data:image/svg+xml,${encodeURIComponent(logoSvg(colors[accent ?? defaultAccent][500]))}")`
}

/** Whose background it is: a board id, or a custom view (its uploaded image has its own URL). */
export type BackgroundOwner = string | { viewId: string }

/** URL path (below the base path) of the owner's uploaded image. */
export function uploadedBackgroundPath(owner: BackgroundOwner): string {
  return typeof owner === 'string' ? `/api/boards/${owner}/background` : `/api/views/${owner.viewId}/background`
}

/**
 * CSS for an element showing the background of `owner` (a board id or a custom view), or undefined when plain.
 * `base` is the app's base path ('' at the root; basePath() in the app); `accent` is the
 * board's accent, which colours the Kanso logo.
 */
export function backgroundStyle(
  bg: BoardBackground | null | undefined, owner: BackgroundOwner, thumb = false, base = '', accent: BoardAccent | null = null,
): Record<string, string> | undefined {
  if (!bg) return undefined
  switch (bg.kind) {
    case 'color':
      return withLogo({ backgroundColor: bg.value }, bg.logo, accent, thumb)
    case 'gradient': {
      const g = backgroundGradients.find(g => g.id === bg.value)
      return g ? withLogo({ backgroundImage: g.css }, bg.logo, accent, thumb) : undefined
    }
    case 'photo':
      return backgroundPhotos.some(p => p.id === bg.value)
        ? imageStyle(`${base}/backgrounds/${bg.value}${thumb ? '-thumb' : ''}.jpg`)
        : undefined
    case 'upload':
      return imageStyle(`${base}${uploadedBackgroundPath(owner)}?v=${encodeURIComponent(bg.value)}`)
  }
}

/**
 * Puts the logo on top of a colour or gradient. On the board page (not `thumb`) it is 50vmin
 * tall and stays in the middle of the window while the board scrolls; tiles get it at 60%.
 */
function withLogo(style: Record<string, string>, logo: boolean | undefined, accent: BoardAccent | null, thumb: boolean) {
  if (!logo) return style
  const image = logoImage(accent)
  const size = thumb ? 'auto 60%' : 'auto 50vmin'
  const under = style.backgroundImage
  const both = (a: string, b: string) => under ? `${a}, ${b}` : a
  return {
    ...style,
    backgroundImage: both(image, under ?? ''),
    backgroundRepeat: both('no-repeat', 'no-repeat'),
    backgroundPosition: both('center', 'center'),
    backgroundSize: both(size, 'cover'),
    ...(!thumb && { backgroundAttachment: both('fixed', 'scroll') }),
  }
}

function imageStyle(url: string) {
  return { backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
}
