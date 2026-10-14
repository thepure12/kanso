/** Toggles a board's star for the current user, optimistically (reverted on failure). */
export function useBoardStar() {
  const showError = useApiError()
  const { t } = useI18n()
  return async function toggleStar(board: { id: string, starred: boolean }) {
    const starred = !board.starred
    board.starred = starred
    try {
      await api(`/api/boards/${board.id}/star`, { method: starred ? 'PUT' : 'DELETE' })
    }
    catch (err) {
      board.starred = !starred
      showError(err, starred ? t('boardStar.starFailed') : t('boardStar.unstarFailed'))
    }
  }
}
