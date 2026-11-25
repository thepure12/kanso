import type { Ref } from 'vue'

export interface ColumnWidthsOptions {
  /** localStorage key instead of the board's (custom views keep their own widths). */
  key?: string
  /** Width of a column without a stored one (default COLUMN_WIDTH_DEFAULT). */
  fallback?: (columnId: string) => number | undefined
}

/**
 * Per-board column widths in the board view (and swimlanes), resized by dragging
 * a column's right edge. Personal, kept in localStorage `kanban:column-widths:<boardId>`.
 * Default widths render on the server and during hydration; stored ones load after mount.
 */
export function useColumnWidths(boardId: string, columnIds: Ref<string[]>, opts: ColumnWidthsOptions = {}) {
  const key = opts.key ?? columnWidthsKey(boardId)
  const widths = ref<ColumnWidths>({})
  const resizing = ref<string | null>(null)

  onMounted(() => {
    try {
      widths.value = parseColumnWidths(localStorage.getItem(key))
    }
    catch { /* storage unavailable */ }
  })

  function save() {
    try {
      const pruned = pruneColumnWidths(widths.value, columnIds.value, !!opts.fallback)
      if (Object.keys(pruned).length) localStorage.setItem(key, JSON.stringify(pruned))
      else localStorage.removeItem(key)
    }
    catch { /* storage unavailable */ }
  }

  const widthOf = (columnId: string) => widths.value[columnId] ?? opts.fallback?.(columnId) ?? COLUMN_WIDTH_DEFAULT
  // Never wider than a phone screen (minus the board padding), so one column fits.
  const styleOf = (columnId: string) => ({ width: `${widthOf(columnId)}px`, maxWidth: 'calc(100vw - 3rem)' })

  function setWidth(columnId: string, px: number) {
    widths.value = { ...widths.value, [columnId]: clampColumnWidth(px) }
  }

  /** Pointer drag on the handle: follows the pointer until release, then saves. */
  function startResize(columnId: string, e: PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget as HTMLElement
    const startX = e.clientX
    const startWidth = widthOf(columnId)
    resizing.value = columnId
    handle.setPointerCapture(e.pointerId)
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'col-resize'

    const onMove = (ev: PointerEvent) => setWidth(columnId, startWidth + ev.clientX - startX)
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      document.body.style.cursor = prevCursor
      resizing.value = null
      save()
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  /** Arrow keys on the focused handle; Home resets. */
  function onResizeKey(columnId: string, e: KeyboardEvent) {
    const step = e.shiftKey ? COLUMN_WIDTH_STEP * 4 : COLUMN_WIDTH_STEP
    if (e.key === 'ArrowLeft') setWidth(columnId, widthOf(columnId) - step)
    else if (e.key === 'ArrowRight') setWidth(columnId, widthOf(columnId) + step)
    else if (e.key === 'Home') clearWidth(columnId)
    else return
    e.preventDefault()
    save()
  }

  /** Back to the fallback width (the default unless `opts.fallback` says otherwise). */
  function clearWidth(columnId: string) {
    const { [columnId]: _, ...rest } = widths.value
    widths.value = rest
  }
  function resetWidth(columnId: string) {
    clearWidth(columnId)
    save()
  }

  return { widths, resizing, widthOf, styleOf, startResize, onResizeKey, resetWidth }
}
