import { describe, expect, it, vi } from 'vitest'
import { useUndo, type UndoEntry } from '~/composables/useUndo'

/** Entry that appends to `log` on undo and redo. */
const entry = (log: string[], name: string, withRedo = true): UndoEntry => ({
  label: name,
  undo: async () => { log.push(`undo ${name}`) },
  redo: withRedo ? async () => { log.push(`redo ${name}`) } : undefined,
})

describe('useUndo', () => {
  it('undoes the latest entry first and redoes it', async () => {
    const log: string[] = []
    const onPush = vi.fn()
    const u = useUndo({ onPush })
    u.push(entry(log, 'a'))
    u.push(entry(log, 'b'))
    expect(onPush).toHaveBeenCalledTimes(2)
    expect(u.nextUndo.value).toBe('b')

    expect(await u.undo()).toBe(true)
    expect(u.canRedo.value).toBe(true)
    expect(await u.redo()).toBe(true)
    expect(await u.undo()).toBe(true)
    expect(await u.undo()).toBe(true)
    expect(await u.undo()).toBe(false)
    expect(log).toEqual(['undo b', 'redo b', 'undo b', 'undo a'])
    expect(u.canUndo.value).toBe(false)
  })

  it('clears redo when a new entry is recorded and skips entries without redo', async () => {
    const log: string[] = []
    const u = useUndo()
    u.push(entry(log, 'a'))
    await u.undo()
    u.push(entry(log, 'b', false))
    expect(u.canRedo.value).toBe(false)
    await u.undo()
    expect(u.canRedo.value).toBe(false)
  })

  it('keeps at most `limit` entries', async () => {
    const log: string[] = []
    const u = useUndo({ limit: 3 })
    for (const n of ['a', 'b', 'c', 'd', 'e']) u.push(entry(log, n))
    while (await u.undo());
    expect(log).toEqual(['undo e', 'undo d', 'undo c'])
  })

  it('drops a failing entry, clears redo and reports the error', async () => {
    const log: string[] = []
    const onError = vi.fn()
    const u = useUndo({ onError })
    u.push(entry(log, 'a'))
    u.push(entry(log, 'b'))
    await u.undo()
    const err = new Error('404')
    const failing = { label: 'x', undo: async () => { throw err } }
    u.push(failing)
    expect(await u.undo()).toBe(false)
    expect(onError).toHaveBeenCalledWith(err, failing)
    expect(u.canRedo.value).toBe(false)
    expect(u.nextUndo.value).toBe('a')
  })

  it('runs one step at a time', async () => {
    let release!: () => void
    const u = useUndo()
    const undo = vi.fn(() => new Promise<void>((r) => { release = r }))
    u.push({ label: 'other', undo: async () => {} })
    u.push({ label: 'slow', undo })
    const first = u.undo()
    expect(await u.undo()).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(u.nextUndo.value).toBe('other')
  })

  it('groups entries pushed while a group runs into one, undone in reverse', async () => {
    const log: string[] = []
    const onPush = vi.fn()
    const u = useUndo({ onPush })
    await u.group('both', async () => {
      await Promise.resolve()
      u.push(entry(log, 'a'))
      u.push(entry(log, 'b'))
    })
    expect(onPush).toHaveBeenCalledTimes(1)
    expect(u.nextUndo.value).toBe('both')
    await u.undo()
    await u.redo()
    expect(log).toEqual(['undo b', 'undo a', 'redo a', 'redo b'])

    // A group with a single entry keeps that entry's label.
    await u.group('one', async () => u.push(entry(log, 'c')))
    expect(u.nextUndo.value).toBe('c')
  })
})
