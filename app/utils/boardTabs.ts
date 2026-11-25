/**
 * Board tabs: the boards a person has open on this device, shown as a tab strip
 * on the board page to switch between them quickly. Personal, kept in
 * localStorage `kanban:board-tabs` together with the user id, so another account
 * on the same browser starts with no tabs.
 */
export interface BoardTab {
  id: string
  name: string
}

export const boardTabsKey = 'kanban:board-tabs'
/** Opening more boards than this drops the oldest-opened tab. */
export const BOARD_TABS_MAX = 12

interface StoredBoardTabs { userId: string, tabs: BoardTab[] }

/** Reads stored tabs for `userId`; anything malformed or stored by someone else gives no tabs. */
export function parseBoardTabs(raw: string | null, userId: string): BoardTab[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Partial<StoredBoardTabs> | null
    if (!parsed || parsed.userId !== userId || !Array.isArray(parsed.tabs)) return []
    const seen = new Set<string>()
    const tabs: BoardTab[] = []
    for (const t of parsed.tabs as unknown[]) {
      if (!t || typeof t !== 'object') continue
      const { id, name } = t as Record<string, unknown>
      if (typeof id !== 'string' || typeof name !== 'string' || seen.has(id)) continue
      seen.add(id)
      tabs.push({ id, name })
    }
    return tabs.slice(-BOARD_TABS_MAX)
  }
  catch {
    return []
  }
}

export function serializeBoardTabs(tabs: BoardTab[], userId: string): string {
  return JSON.stringify({ userId, tabs } satisfies StoredBoardTabs)
}

/** Adds a tab at the end, or renames the existing one in place. Drops the first tabs past the limit. */
export function openBoardTab(tabs: BoardTab[], tab: BoardTab, max = BOARD_TABS_MAX): BoardTab[] {
  const i = tabs.findIndex(t => t.id === tab.id)
  if (i >= 0) {
    if (tabs[i]!.name === tab.name) return tabs
    return tabs.map((t, j) => j === i ? { ...tab } : t)
  }
  const next = [...tabs, { ...tab }]
  return next.length > max ? next.slice(next.length - max) : next
}

/** Removes a tab; `next` is the tab to show instead (the one to its right, else its left; null when none is left). */
export function closeBoardTab(tabs: BoardTab[], id: string): { tabs: BoardTab[], next: string | null } {
  const i = tabs.findIndex(t => t.id === id)
  if (i < 0) return { tabs, next: null }
  const rest = tabs.filter(t => t.id !== id)
  return { tabs: rest, next: (rest[i] ?? rest[i - 1])?.id ?? null }
}

/** The tab `step` places from `id` (wrapping), or null with fewer than two tabs or an unknown id. */
export function stepBoardTab(tabs: BoardTab[], id: string, step: number): string | null {
  const i = tabs.findIndex(t => t.id === id)
  if (i < 0 || tabs.length < 2) return null
  return tabs[((i + step) % tabs.length + tabs.length) % tabs.length]!.id
}

/**
 * Puts the tabs in the order of `ids` (a drag in the strip). Unknown ids are
 * ignored; tabs missing from `ids` (opened meanwhile in another browser tab)
 * keep their order after the others. Returns `tabs` itself when nothing moves.
 */
export function reorderBoardTabs(tabs: BoardTab[], ids: string[]): BoardTab[] {
  const byId = new Map(tabs.map(t => [t.id, t]))
  const seen = new Set<string>()
  const next: BoardTab[] = []
  for (const id of ids) {
    const tab = byId.get(id)
    if (!tab || seen.has(id)) continue
    seen.add(id)
    next.push(tab)
  }
  for (const tab of tabs) if (!seen.has(tab.id)) next.push(tab)
  return next.every((t, i) => t === tabs[i]) ? tabs : next
}

/** Moves a tab `step` places left (negative) or right, stopping at the ends. Returns `tabs` itself when it cannot move. */
export function moveBoardTab(tabs: BoardTab[], id: string, step: number): BoardTab[] {
  const i = tabs.findIndex(t => t.id === id)
  if (i < 0) return tabs
  const to = Math.min(tabs.length - 1, Math.max(0, i + step))
  if (to === i) return tabs
  const next = tabs.filter(t => t.id !== id)
  next.splice(to, 0, tabs[i]!)
  return next
}
