/**
 * Order of the comments in the card dialog (Comments tab and the merged
 * "Comments & Matrix" tab): `newest` first (default) or `oldest` first, chat
 * style with the composer below the list. A personal choice for all boards,
 * kept in localStorage `kanban:comment-order` (`oldest`); newest first on the
 * server and until `loadCommentOrder()` runs after mount.
 */
export type CommentOrder = 'newest' | 'oldest'

const storeKey = 'kanban:comment-order'

export const useCommentOrder = () => useState<CommentOrder>('comment-order', () => 'newest')

export function loadCommentOrder() {
  const state = useCommentOrder()
  try {
    state.value = localStorage.getItem(storeKey) === 'oldest' ? 'oldest' : 'newest'
  }
  catch { /* storage unavailable */ }
}

export function setCommentOrder(order: CommentOrder) {
  useCommentOrder().value = order
  try {
    if (order === 'oldest') localStorage.setItem(storeKey, 'oldest')
    else localStorage.removeItem(storeKey)
  }
  catch { /* storage unavailable */ }
}
