/** Shows a toast for a failed $fetch call. */
export function useApiError() {
  const toast = useToast()
  const { t } = useI18n()
  return (err: unknown, title = t('common.somethingWentWrong')) => {
    const e = err as { data?: { statusMessage?: string, message?: string }, statusMessage?: string }
    toast.add({ title, description: e.data?.statusMessage || e.data?.message || e.statusMessage, color: 'error' })
  }
}
