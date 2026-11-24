import type { MyWorkCard } from '#shared/types/myWork'

/**
 * Marks a My work card complete or open again (card PATCH `completed`) with an
 * Undo toast. `apply` updates the caller's list at once, `reload` fetches it
 * again after the request (or after a failure, which also shows the error).
 */
export function useMyWorkComplete(apply: (id: string, completed: boolean) => void, reload: () => void) {
  const { t } = useI18n()
  const toast = useToast()
  const showError = useApiError()

  async function setCompleted(card: Pick<MyWorkCard, 'id' | 'title'>, completed: boolean, offerUndo = true) {
    apply(card.id, completed)
    try {
      await api(`/api/cards/${card.id}`, { method: 'PATCH', body: { completed } })
    }
    catch (e) {
      showError(e)
      reload()
      return
    }
    reload()
    if (!offerUndo) return
    toast.add({
      title: t(completed ? 'myWork.markedComplete' : 'myWork.reopened', { title: card.title }),
      icon: completed ? 'i-lucide-circle-check' : 'i-lucide-circle',
      color: completed ? 'success' : 'neutral',
      duration: 6000,
      actions: [{ label: t('board.undo.action'), icon: 'i-lucide-undo-2', color: 'neutral', variant: 'outline', onClick: () => { setCompleted(card, !completed, false) } }],
    })
  }
  return { setCompleted }
}
