import { CARD_TITLE_MAX } from '#shared/cards'

interface ValidationIssue { code?: string, path?: (string | number)[], maximum?: number }

/** Shows a toast for a failed $fetch call. */
export function useApiError() {
  const toast = useToast()
  const { t } = useI18n()
  return (err: unknown, title = t('common.somethingWentWrong')) => {
    const e = err as { data?: { statusMessage?: string, message?: string, data?: { issues?: ValidationIssue[] } }, statusMessage?: string }
    toast.add({ title, description: knownIssue(e.data?.data?.issues) || e.data?.statusMessage || e.data?.message || e.statusMessage, color: 'error' })
  }

  /** Own wording for validation errors the UI can hit; the server's text is English. */
  function knownIssue(issues: ValidationIssue[] | undefined) {
    const titleTooLong = issues?.find(i => i.code === 'too_big' && i.path?.at(-1) === 'title')
    if (titleTooLong) return t('card.errors.titleTooLong', { max: titleTooLong.maximum ?? CARD_TITLE_MAX })
  }
}
