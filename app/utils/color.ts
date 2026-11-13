/** Black or white, whichever reads better on a #rrggbb background (WCAG relative luminance). */
export function contrastText(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

/** Quick picks offered wherever a colour is chosen. */
export const colorPresets = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b']

/** Where the colours already used on a board live (BoardDetail parts, kept current by useBoard). */
export interface BoardColorSources {
  tags?: { color: string }[]
  columns?: { color: string | null, outline?: { color: string | null } | null }[]
  columnGroups?: { color: string | null }[]
  fields?: { options: { color: string }[] }[]
  columnOutline?: { color: string | null } | null
  background?: { kind: string, value: string } | null
}

/**
 * Hex colours already used on a board (tags, column headings and outlines, column groups,
 * select options, board outline, plain background), lower case, most used first,
 * without the ones in `exclude` (the picker's own presets).
 */
export function boardColors(src: BoardColorSources, exclude: readonly string[] = colorPresets, limit = 12): string[] {
  const found: (string | null | undefined)[] = [
    ...(src.tags ?? []).map(t => t.color),
    ...(src.columns ?? []).flatMap(c => [c.color, c.outline?.color]),
    ...(src.columnGroups ?? []).map(g => g.color),
    ...(src.fields ?? []).flatMap(f => f.options.map(o => o.color)),
    src.columnOutline?.color,
    src.background?.kind === 'color' ? src.background.value : null,
  ]
  const skip = new Set(exclude.map(c => c.toLowerCase()))
  const counts = new Map<string, number>()
  for (const c of found) {
    if (!c || !/^#[0-9a-f]{6}$/i.test(c)) continue
    const key = c.toLowerCase()
    if (!skip.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  // Map keeps first-seen order, and sort is stable: ties stay in board order.
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c)
}

/** Colours in use on the open board, provided by useBoard for ColorField and ColumnOutlinePicker. */
export const boardColorsKey: InjectionKey<Ref<BoardColorSources>> = Symbol('boardColors')
