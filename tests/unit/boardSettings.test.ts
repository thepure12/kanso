import { describe, expect, it, vi } from 'vitest'
import { boardMenuGroups, settingsSections, type BoardSettingsSection } from '../../app/utils/boardSettings'

const sections = (): BoardSettingsSection[] => [
  { key: 'setup', label: 'Set up', items: [
    { key: 'tags', label: 'Tags', icon: 'i-tag', count: 3, description: 'Labels', settingsOnly: true, onSelect: () => {} },
    { key: 'fields', label: 'Fields', icon: 'i-list', count: 1, description: 'Extra values', onSelect: () => {} },
  ] },
  { key: 'display', label: 'Display', items: [
    { key: 'tagNames', label: 'Tag names', icon: 'i-tag', type: 'checkbox', checked: true, onUpdateChecked: () => {} },
  ] },
  { key: 'manage', label: 'Manage', danger: true, items: [
    { key: 'rename', label: 'Rename', icon: 'i-pencil', menuOnly: true, onSelect: () => {} },
  ] },
  { key: 'empty', label: 'Empty', items: [] },
]

describe('boardMenuGroups', () => {
  it('heads each non-empty section with its label and leaves out settings-only items', () => {
    const groups = boardMenuGroups(sections())
    expect(groups.map(g => g.map(i => i.label))).toEqual([
      ['Set up', 'Fields'],
      ['Display', 'Tag names'],
      ['Manage', 'Rename'],
    ])
    expect(groups[0]![0]).toMatchObject({ type: 'label' })
  })

  it('drops the settings page fields from menu items', () => {
    const item = boardMenuGroups(sections())[0]![1]!
    expect(item).not.toHaveProperty('description')
    expect(item).not.toHaveProperty('count')
    expect(item).not.toHaveProperty('key')
  })

  it('keeps the menu open when a checkbox is toggled', () => {
    const item = boardMenuGroups(sections())[1]![1]!
    const e = { preventDefault: vi.fn() } as unknown as Event
    item.onSelect!(e)
    expect(e.preventDefault).toHaveBeenCalled()
  })
})

describe('settingsSections', () => {
  it('leaves out menu-only items and sections left empty', () => {
    expect(settingsSections(sections()).map(s => [s.key, s.items.map(i => i.key)])).toEqual([
      ['setup', ['tags', 'fields']],
      ['display', ['tagNames']],
    ])
  })
})
