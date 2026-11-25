/** Toggles a custom view's star, optimistically (reverted on failure). */
export function useViewStar() {
  const showError = useApiError()
  const { t } = useI18n()
  return async function toggleViewStar(view: { id: string, starred: boolean }) {
    const starred = !view.starred
    view.starred = starred
    try {
      await $fetch(`/api/views/${view.id}/star`, { method: starred ? 'PUT' : 'DELETE' })
    }
    catch (err) {
      view.starred = !starred
      showError(err, starred ? t('customViews.starFailed') : t('customViews.unstarFailed'))
    }
  }
}
