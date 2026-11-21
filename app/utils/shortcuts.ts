/** One row of the shortcuts help. `kbds` are UKbd values; `sequence` means press them one after another; `description` is an i18n key. */
export interface ShortcutHelp {
  kbds: string[]
  description: string
  sequence?: boolean
}

/** What the `d`, `t` and `m` card shortcuts open in `CardQuickEdit`. */
export type QuickEditMode = 'due' | 'tags' | 'assignees'

/** Everything bound with defineShortcuts (layout and board page), for the `?` help. */
export const shortcutGroups: { label: string, items: ShortcutHelp[] }[] = [
  {
    label: 'shortcuts.anywhere',
    items: [
      { kbds: ['meta', 'k'], description: 'shortcuts.search' },
      { kbds: ['?'], description: 'shortcuts.help' },
      { kbds: ['g', 'h'], sequence: true, description: 'shortcuts.home' },
      { kbds: ['g', 'm'], sequence: true, description: 'shortcuts.myWork' },
      { kbds: ['g', 'i'], sequence: true, description: 'shortcuts.inbox' },
    ],
  },
  {
    label: 'shortcuts.onBoard',
    items: [
      { kbds: ['/'], description: 'shortcuts.filter' },
      { kbds: ['n'], description: 'shortcuts.newCard' },
      { kbds: ['meta', 'enter'], description: 'shortcuts.addAndOpenCard' },
      { kbds: ['meta', 'z'], description: 'shortcuts.undo' },
      { kbds: ['meta', 'shift', 'z'], description: 'shortcuts.redo' },
      { kbds: ['g', 't'], sequence: true, description: 'shortcuts.nextBoardTab' },
      { kbds: ['shift', 'click'], description: 'shortcuts.selectCard' },
      { kbds: ['meta', 'enter'], description: 'shortcuts.saveCard' },
      { kbds: ['escape'], description: 'shortcuts.escape' },
    ],
  },
  {
    label: 'shortcuts.onCard',
    items: [
      { kbds: ['arrowleft', 'arrowdown', 'arrowup', 'arrowright'], description: 'shortcuts.moveFocus' },
      { kbds: ['h', 'j', 'k', 'l'], description: 'shortcuts.moveFocusLetters' },
      { kbds: ['enter'], description: 'shortcuts.openCard' },
      { kbds: ['e'], description: 'shortcuts.editTitle' },
      { kbds: ['a'], description: 'shortcuts.assignMe' },
      { kbds: ['m'], description: 'shortcuts.pickAssignees' },
      { kbds: ['t'], description: 'shortcuts.pickTags' },
      { kbds: ['d'], description: 'shortcuts.pickDueDate' },
      { kbds: ['c'], description: 'shortcuts.archiveCard' },
      { kbds: ['x'], description: 'shortcuts.toggleSelect' },
      { kbds: ['[', ']'], description: 'shortcuts.moveCardColumn' },
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
