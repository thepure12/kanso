import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * One board setting or action. The board page builds them once for both the board
 * menu (short: label and icon) and the settings page (with description, count and
 * the button text).
 */
export interface BoardSettingsItem {
  key: string
  label: string
  icon: string
  /** Settings page only: what it is for. */
  description?: string
  /** Settings page only: how many there are (tags, rules, ...). */
  count?: number
  /** Settings page only: button text instead of "Open" (actions like Archive). */
  action?: string
  /** Only in the menu (the settings page edits it in place, e.g. the name). */
  menuOnly?: boolean
  /** Only on the settings page (the board header has its own button, e.g. tags). */
  settingsOnly?: boolean
  color?: 'error'
  onSelect?: () => void
  to?: string
  external?: boolean
  download?: boolean
  type?: 'checkbox'
  checked?: boolean
  onUpdateChecked?: (value: boolean) => void
}

export interface BoardSettingsSection {
  key: string
  label: string
  /** Drawn as a danger zone on the settings page. */
  danger?: boolean
  items: BoardSettingsItem[]
}

/** The board menu: one group per non-empty section, headed by its label. */
export function boardMenuGroups(sections: BoardSettingsSection[]): DropdownMenuItem[][] {
  return sections
    .map(s => ({ ...s, items: s.items.filter(i => !i.settingsOnly) }))
    .filter(s => s.items.length)
    .map(s => [
      { label: s.label, type: 'label' as const },
      ...s.items.map(({ key: _key, description: _d, count: _c, action: _a, menuOnly: _m, settingsOnly: _s, ...item }) => {
        // Checkbox items stay open when toggled.
        return item.type === 'checkbox' ? { ...item, onSelect: (e: Event) => e.preventDefault() } : item
      }),
    ])
}

/** The settings page: sections without menu-only items, empty ones dropped. */
export function settingsSections(sections: BoardSettingsSection[]): BoardSettingsSection[] {
  return sections
    .map(s => ({ ...s, items: s.items.filter(i => !i.menuOnly) }))
    .filter(s => s.items.length)
}
