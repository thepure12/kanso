import type { Ref } from 'vue'

/**
 * Columns collapsed to a narrow strip in the board view and swimlanes.
 * Personal, per board, kept in localStorage `kanban:collapsed-columns:<boardId>`.
 * Everything renders expanded on the server and during hydration; stored state loads after mount.
 */
export function useCollapsedColumns(boardId: string, columnIds: Ref<string[]>, opts: { key?: string } = {}) {
  const key = opts.key ?? collapsedColumnsKey(boardId)
  const collapsed = ref(new Set<string>())

  onMounted(() => {
    try {
      collapsed.value = new Set(parseCollapsedColumns(localStorage.getItem(key)))
    }
    catch { /* storage unavailable */ }
  })

  function save() {
    try {
      const pruned = pruneCollapsedColumns(collapsed.value, columnIds.value)
      if (pruned.length) localStorage.setItem(key, JSON.stringify(pruned))
      else localStorage.removeItem(key)
    }
    catch { /* storage unavailable */ }
  }

  const isCollapsed = (columnId: string) => collapsed.value.has(columnId)

  function setCollapsed(columnId: string, value: boolean) {
    const next = new Set(collapsed.value)
    if (value) next.add(columnId)
    else next.delete(columnId)
    collapsed.value = next
    save()
  }

  const toggle = (columnId: string) => setCollapsed(columnId, !isCollapsed(columnId))

  return { collapsed, isCollapsed, setCollapsed, toggle }
}
