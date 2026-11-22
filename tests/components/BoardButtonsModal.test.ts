import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import BoardButtonsModal from '~/components/BoardButtonsModal.vue'
import type { BoardButton } from '#shared/buttons'

const buttons: BoardButton[] = [
  { id: 'b1', scope: 'card', name: 'Ship', icon: 'i-lucide-rocket', color: '#22c55e', tooltip: null, shared: true, columnIds: null, cardIds: [], steps: [{ kind: 'move', columnId: 'c2' }, { kind: 'assignMe' }] },
  { id: 'b3', scope: 'card', name: 'Approve', icon: null, color: '#22c55e', tooltip: 'Moves it on', shared: true, columnIds: ['c2'], cardIds: [], steps: [{ kind: 'archive' }] },
  { id: 'b2', scope: 'board', name: 'Clean up', icon: null, color: 'accent', tooltip: null, shared: false, columnIds: null, cardIds: [], steps: [{ kind: 'archiveColumn', columnId: 'gone' }] },
]
const columns = [{ id: 'c1', title: 'Doing', position: 1, color: null, wipLimit: null, outline: null, rules: [] }, { id: 'c2', title: 'Done', position: 2, color: null, wipLimit: null, outline: null, rules: [] }]

const mount = (canEdit: boolean) => mountSuspended(BoardButtonsModal, {
  attachTo: document.body,
  props: { open: true, buttons, columns, tags: [], members: [], canEdit, create: vi.fn(), update: vi.fn(), remove: vi.fn() },
})

describe('BoardButtonsModal', () => {
  it('lists card and board buttons with their steps', async () => {
    const w = await mount(true)
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Ship')
    expect(text).toContain('Move to Done')
    expect(text).toContain('Assign me')
    expect(text).toContain('Archive all cards in ?')
    expect(text).toContain('Only on cards in Done')
    expect(text).toContain('Moves it on')
    expect(document.body.querySelector('[aria-label="Edit Ship"]')).not.toBeNull()
    w.unmount()
  })

  it('hides edit for shared buttons from people who cannot edit the board', async () => {
    const w = await mount(false)
    await flushPromises()
    expect(document.body.querySelector('[aria-label="Edit Ship"]')).toBeNull()
    expect(document.body.querySelector('[aria-label="Edit Clean up"]')).not.toBeNull()
    w.unmount()
  })
  it('opens the step editor for a new button', async () => {
    const w = await mount(true)
    await flushPromises()
    const add = [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('New card button'))!
    add.click()
    await flushPromises()
    expect(document.body.querySelector('[aria-label="Step 1"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Share with the board')
    const save = [...document.body.querySelectorAll('button[type="submit"]')].at(-1) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    w.unmount()
  })

  it('starts a new card button with no columns picked instead of all columns', async () => {
    const w = await mount(true)
    await flushPromises()
    const add = [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('New card button'))!
    add.click()
    await flushPromises()
    const allColumns = [...document.body.querySelectorAll('[role="switch"]')].find(s => s.closest('div')?.parentElement?.textContent?.includes('All columns')) as HTMLElement
    expect(allColumns.getAttribute('aria-checked')).toBe('false')
    expect(document.body.textContent).toContain('Show on cards in')
    // No column is allowed: the button then goes on single cards from the card dialog.
    expect(document.body.textContent).toContain('add the button to single cards in the card dialog')
    w.unmount()
  })

  it('takes chosen columns off a card button again, one by one or all at once', async () => {
    const update = vi.fn()
    const w = await mountSuspended(BoardButtonsModal, {
      attachTo: document.body,
      props: { open: true, buttons, columns, tags: [], members: [], canEdit: true, create: vi.fn(), update, remove: vi.fn() },
    })
    await flushPromises()
    const save = () => ([...document.body.querySelectorAll('button[type="submit"]')].at(-1) as HTMLButtonElement).click()
    ;(document.body.querySelector('[aria-label="Edit Approve"]') as HTMLElement).click()
    await flushPromises()
    const trigger = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Done')!
    trigger.click()
    await flushPromises()
    const option = [...document.body.querySelectorAll('[role="option"]')].find(o => o.textContent?.includes('Done')) as HTMLElement
    expect(option.getAttribute('data-state')).toBe('checked')
    option.click()
    await flushPromises()
    save()
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b3' }), expect.objectContaining({ columnIds: [] }))

    ;(document.body.querySelector('[aria-label="Edit Approve"]') as HTMLElement).click()
    await flushPromises()
    const clear = document.body.querySelector('[aria-label="Remove all columns"]') as HTMLElement
    expect(clear).not.toBeNull()
    clear.click()
    await flushPromises()
    expect(document.body.querySelector('[aria-label="Remove all columns"]')).toBeNull()
    save()
    await flushPromises()
    expect(update).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b3' }), expect.objectContaining({ columnIds: [] }))
    w.unmount()
  })
})
