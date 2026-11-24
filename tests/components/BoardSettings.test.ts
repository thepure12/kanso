import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import BoardSettings from '~/components/BoardSettings.vue'
import type { BoardSettingsSection } from '~/utils/boardSettings'

const board = { id: 'b1', name: 'Roadmap', notificationLevel: 'all' as const, team: null }

function sections(open = vi.fn(), toggle = vi.fn()): BoardSettingsSection[] {
  return [
    { key: 'setup', label: 'Set up', items: [
      { key: 'fields', label: 'Custom fields', icon: 'i-lucide-list-plus', description: 'Extra values', count: 2, onSelect: open },
    ] },
    { key: 'display', label: 'Display', items: [
      { key: 'tagNames', label: 'Show card tag names', icon: 'i-lucide-tag', type: 'checkbox', checked: true, onUpdateChecked: toggle },
    ] },
  ]
}

describe('BoardSettings', () => {
  it('lists the sections with descriptions and counts, and opens an item', async () => {
    const open = vi.fn()
    const w = await mountSuspended(BoardSettings, { props: { board, sections: sections(open), canRename: false, rename: vi.fn() } })
    const setup = w.find('[data-testid="board-settings-setup"]')
    expect(setup.text()).toContain('Custom fields')
    expect(setup.text()).toContain('Extra values')
    expect(setup.text()).toContain('2')
    await setup.find('button').trigger('click')
    expect(open).toHaveBeenCalled()
  })

  it('toggles checkbox items with a switch', async () => {
    const toggle = vi.fn()
    const w = await mountSuspended(BoardSettings, { props: { board, sections: sections(vi.fn(), toggle), canRename: false, rename: vi.fn() } })
    await w.find('[data-testid="board-settings-display"] button[role="switch"]').trigger('click')
    expect(toggle).toHaveBeenCalledWith(false)
  })

  it('renames the board for owners', async () => {
    const rename = vi.fn()
    const w = await mountSuspended(BoardSettings, { props: { board, sections: [], canRename: true, rename } })
    await w.find('input[data-testid="board-settings-name"]').setValue('  Plans ')
    await w.find('form').trigger('submit')
    expect(rename).toHaveBeenCalledWith('Plans')
  })

  it('keeps the name read-only for everyone else', async () => {
    const w = await mountSuspended(BoardSettings, { props: { board, sections: [], canRename: false, rename: vi.fn() } })
    expect(w.find('input[data-testid="board-settings-name"]').attributes('disabled')).toBeDefined()
    expect(w.find('form button[type="submit"]').exists()).toBe(false)
  })
})
