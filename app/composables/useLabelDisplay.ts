/**
 * Whether tag chips and column group chips show their names or only their colour.
 * A personal display choice for all boards, kept in localStorage `kanban:labels`.
 * Names show on the server and during hydration; `loadLabelDisplay()` reads the
 * stored choice after mount.
 */
interface LabelDisplay { tagNames: boolean, groupNames: boolean }

const storeKey = 'kanban:labels'
const defaults: LabelDisplay = { tagNames: true, groupNames: true }

export const useLabelDisplay = () => useState<LabelDisplay>('label-display', () => ({ ...defaults }))

export function loadLabelDisplay() {
  const state = useLabelDisplay()
  try {
    const stored = JSON.parse(localStorage.getItem(storeKey) ?? '{}')
    state.value = {
      tagNames: stored.tagNames !== false,
      groupNames: stored.groupNames !== false,
    }
  }
  catch { /* storage unavailable or bad JSON */ }
}

export function setLabelDisplay(patch: Partial<LabelDisplay>) {
  const state = useLabelDisplay()
  state.value = { ...state.value, ...patch }
  try {
    localStorage.setItem(storeKey, JSON.stringify(state.value))
  }
  catch { /* storage unavailable */ }
}
