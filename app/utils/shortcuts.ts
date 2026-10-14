/** One row of the shortcuts help. `kbds` are UKbd values; `sequence` means press them one after another; `description` is an i18n key. */
export interface ShortcutHelp {
  kbds: string[]
  description: string
  sequence?: boolean
}

/** Everything bound with defineShortcuts (layout and board page), for the `?` help. */
export const shortcutGroups: { label: string, items: ShortcutHelp[] }[] = [
  {
    label: 'shortcuts.anywhere',
    items: [
      { kbds: ['meta', 'k'], description: 'shortcuts.search' },
      { kbds: ['?'], description: 'shortcuts.help' },
      { kbds: ['g', 'h'], sequence: true, description: 'shortcuts.home' },
      { kbds: ['g', 'm'], sequence: true, description: 'shortcuts.myWork' },
    ],
  },
  {
    label: 'shortcuts.onBoard',
    items: [
      { kbds: ['/'], description: 'shortcuts.filter' },
      { kbds: ['n'], description: 'shortcuts.newCard' },
      { kbds: ['meta', 'z'], description: 'shortcuts.undo' },
      { kbds: ['meta', 'shift', 'z'], description: 'shortcuts.redo' },
      { kbds: ['shift', 'click'], description: 'shortcuts.selectCard' },
      { kbds: ['escape'], description: 'shortcuts.escape' },
    ],
  },
]

/**
 * True while a modal, slideover or similar dialog is open. Single-key shortcuts
 * skip then, so they never act on the page behind it. (defineShortcuts already
 * skips them while typing in inputs, textareas and contenteditable elements.)
 */
export function dialogOpen(): boolean {
  return import.meta.client && !!document.querySelector('[role="dialog"]')
}
