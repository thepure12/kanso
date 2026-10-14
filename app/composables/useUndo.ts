import { computed, shallowRef } from 'vue'

/** One undoable operation: `undo` reverts it, `redo` (optional) applies it again. Both throw on failure. */
export interface UndoEntry {
  label: string
  undo: () => Promise<void>
  redo?: () => Promise<void>
}

export interface UndoOptions {
  /** Most entries kept; the oldest are dropped. */
  limit?: number
  /** Called when an entry is recorded (not for entries collected into a group until it closes). */
  onPush?: (entry: UndoEntry) => void
  /** Called when undo or redo throws; the entry is dropped and the redo stack cleared. */
  onError?: (err: unknown, entry: UndoEntry) => void
}

/**
 * Undo/redo stack of async operations. Recording a new entry clears redo.
 * One undo or redo runs at a time; calls made meanwhile are ignored.
 */
export function useUndo(options: UndoOptions = {}) {
  const limit = options.limit ?? 20
  const done = shallowRef<UndoEntry[]>([])
  const undone = shallowRef<UndoEntry[]>([])
  const running = shallowRef(false)
  let collecting: UndoEntry[] | null = null

  function push(entry: UndoEntry) {
    if (collecting) {
      collecting.push(entry)
      return
    }
    done.value = [...done.value, entry].slice(-limit)
    undone.value = []
    options.onPush?.(entry)
  }

  async function step(from: typeof done, to: typeof done, action: (e: UndoEntry) => Promise<void>) {
    const entry = from.value.at(-1)
    if (!entry || running.value) return false
    running.value = true
    from.value = from.value.slice(0, -1)
    try {
      await action(entry)
      if (to === done || entry.redo) to.value = [...to.value, entry].slice(-limit)
      return true
    }
    catch (err) {
      undone.value = []
      options.onError?.(err, entry)
      return false
    }
    finally {
      running.value = false
    }
  }

  /** Reverts the latest entry; resolves to false when there was none, one was running, or it failed. */
  const undo = () => step(done, undone, e => e.undo())

  /** Applies the latest undone entry again (entries without `redo` are not kept for redo). */
  const redo = () => step(undone, done, e => e.redo!())

  /**
   * Runs `fn`; entries pushed until it settles become one entry (undone in
   * reverse order), e.g. a swimlane drop that moves a card and sets its lane.
   */
  async function group<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (collecting) return fn()
    const items: UndoEntry[] = []
    collecting = items
    try { return await fn() }
    finally {
      collecting = null
      if (items.length === 1) push(items[0]!)
      else if (items.length > 1) {
        push({
          label,
          undo: async () => {
            for (const e of [...items].reverse()) await e.undo()
          },
          redo: items.every(e => e.redo)
            ? async () => {
              for (const e of items) await e.redo!()
            }
            : undefined,
        })
      }
    }
  }

  function clear() {
    done.value = []
    undone.value = []
  }

  return {
    push,
    undo,
    redo,
    group,
    clear,
    running,
    canUndo: computed(() => done.value.length > 0),
    canRedo: computed(() => undone.value.length > 0),
    /** Label of the entry the next undo reverts. */
    nextUndo: computed(() => done.value.at(-1)?.label ?? null),
  }
}

export type UndoStack = ReturnType<typeof useUndo>
