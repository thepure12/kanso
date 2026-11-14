/**
 * Whether the card dialog shows comments and the Matrix thread in one tab.
 * A personal choice for all boards, kept in localStorage `kanban:card-conversation`
 * (`merged`); separate tabs on the server and until `loadCardConversation()` runs
 * after mount.
 */
const storeKey = 'kanban:card-conversation'

export const useCardConversationMerged = () => useState<boolean>('card-conversation-merged', () => false)

export function loadCardConversation() {
  const state = useCardConversationMerged()
  try {
    state.value = localStorage.getItem(storeKey) === 'merged'
  }
  catch { /* storage unavailable */ }
}

export function setCardConversationMerged(merged: boolean) {
  useCardConversationMerged().value = merged
  try {
    if (merged) localStorage.setItem(storeKey, 'merged')
    else localStorage.removeItem(storeKey)
  }
  catch { /* storage unavailable */ }
}
