import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import BoardButtonsModal from '~/components/BoardButtonsModal.vue'
import type { BoardButton } from '#shared/buttons'

const buttons: BoardButton[] = [
  { id: 'b1', scope: 'card', name: 'Ship', icon: 'i-lucide-rocket', color: 'success', shared: true, steps: [{ kind: 'move', columnId: 'c2' }, { kind: 'assignMe' }] },
  { id: 'b2', scope: 'board', name: 'Clean up', icon: null, color: 'neutral', shared: false, steps: [{ kind: 'archiveColumn', columnId: 'gone' }] },
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
})
