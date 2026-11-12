// Column outline: colour, thickness and glow of the frame around a column in
// the board view. The board's default is boards.column_outline (null = the
// 1 px neutral ring); a column can override it with columns.outline (null =
// the board's). The checks boards_column_outline_shape / columns_outline_shape
// mirror this schema. Colour 'accent' follows the board accent (--ui-primary),
// 'column' the column's heading colour.
import { z } from 'zod'

export const columnOutlineWidths = [1, 2, 3, 4] as const
export const columnOutlineGlows = [0, 1, 2, 3] as const

export const columnOutlineSchema = z.object({
  color: z.union([z.literal(['accent', 'column']), z.string().regex(/^#[0-9a-f]{6}$/)]).nullable(),
  width: z.literal(columnOutlineWidths),
  glow: z.literal(columnOutlineGlows),
})

export type ColumnOutline = z.infer<typeof columnOutlineSchema>

/** Preset frame colours (Tailwind 500 shades and white); any #rrggbb is allowed. */
export const columnOutlineColors = [
  '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6',
  '#0ea5e9', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b', '#ffffff',
] as const

export const defaultColumnOutline: ColumnOutline = { color: null, width: 1, glow: 0 }

const glowBlur = [0, 6, 12, 20]

/** CSS colour of an outline colour setting; 'column' without a column colour falls back to the border colour. */
export function columnOutlineColor(color: ColumnOutline['color'], columnColor?: string | null): string {
  if (color === 'accent') return 'var(--ui-primary)'
  if (color === 'column') return columnColor ?? 'var(--ui-border)'
  return color ?? 'var(--ui-border)'
}

/** The outline a column shows: its own, else the board's. */
export function effectiveColumnOutline(column: { outline?: ColumnOutline | null }, board: ColumnOutline | null | undefined): ColumnOutline | null {
  return column.outline ?? board ?? null
}

/**
 * Inline style for a column frame, or null for the default ring classes.
 * Over the WIP limit the frame turns the error colour, keeping width and glow.
 */
export function columnOutlineStyle(outline: ColumnOutline | null | undefined, overWip = false, columnColor?: string | null): Record<string, string> | null {
  if (!outline) return null
  const color = overWip ? 'var(--ui-error)' : columnOutlineColor(outline.color, columnColor)
  const style: Record<string, string> = {
    outline: `${outline.width}px solid ${color}`,
    outlineOffset: `-${outline.width}px`,
  }
  if (outline.glow) style.boxShadow = `0 0 ${glowBlur[outline.glow]}px color-mix(in srgb, ${color} 70%, transparent)`
  return style
}
