import type { BoardTab } from '~/utils/boardTabs'
import { boardTabsKey, closeBoardTab, openBoardTab, parseBoardTabs, serializeBoardTabs } from '~/utils/boardTabs'

let listening = false

/**
 * Open board tabs of the signed-in user on this device (see `app/utils/boardTabs.ts`).
 * Call during setup; the returned functions work in later callbacks too. Empty
 * during SSR; storage is read after mount. Other browser tabs follow changes
 * through the `storage` event.
 */
export function useBoardTabs() {
  const tabs = useState<BoardTab[]>('board-tabs', () => [])
  const { user } = useUserSession()

  function load() {
    if (!import.meta.client) return
    const userId = user.value?.id
    try {
      tabs.value = userId ? parseBoardTabs(localStorage.getItem(boardTabsKey), userId) : []
    }
    catch { tabs.value = [] }
  }

  function save(next: BoardTab[]) {
    tabs.value = next
    const userId = user.value?.id
    if (!userId) return
    try {
      localStorage.setItem(boardTabsKey, serializeBoardTabs(next, userId))
    }
    catch { /* storage unavailable */ }
  }

  if (import.meta.client && !listening) {
    listening = true
    window.addEventListener('storage', (e) => {
      if (e.key === boardTabsKey || e.key === null) load()
    })
  }

  return {
    tabs,
    /** Adds the board as a tab (or updates its name). */
    remember(tab: BoardTab) {
      if (!import.meta.client) return
      load()
      const next = openBoardTab(tabs.value, tab)
      if (next !== tabs.value) save(next)
    },
    /** Closes a tab; returns the id of the tab to show instead, if any. */
    forget(id: string): string | null {
      if (!import.meta.client) return null
      load()
      const { tabs: rest, next } = closeBoardTab(tabs.value, id)
      save(rest)
      return next
    },
  }
}
