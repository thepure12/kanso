import type { CardMatrixThread, MatrixThreadMessage, MatrixThreadView } from '#shared/types/matrix'
import type { CardDetailApi } from '~/composables/useCardDetail'

/**
 * A card's Matrix thread as shown in the card dialog: the messages, read from
 * Matrix while the component that calls this is mounted (every 30 s, and when
 * the tab becomes visible again), and the reply box (the bot posts the reply
 * into the thread with the writer's name).
 */
export function useMatrixThread(cd: CardDetailApi, thread: () => CardMatrixThread | null | undefined) {
  const { t } = useI18n()
  const showError = useApiError()

  const view = ref<MatrixThreadView | null>(null)
  const loadError = ref<string | null>(null)
  const refreshing = ref(false)
  let loadedFor: string | null = null

  async function loadMessages(quiet = false) {
    const current = thread()
    if (!current) {
      view.value = null
      loadedFor = null
      return
    }
    const key = `${current.roomId}/${current.eventId}`
    if (loadedFor !== key) view.value = null
    refreshing.value = true
    try {
      view.value = await api<MatrixThreadView>(`/api/cards/${cd.cardId.value}/matrix-thread`)
      loadedFor = key
      loadError.value = null
    }
    catch (err) {
      const message = (err as { data?: { statusMessage?: string } }).data?.statusMessage ?? t('matrix.thread.loadFailed')
      if (!quiet || !view.value) loadError.value = message
      if (!quiet) showError(err, t('matrix.thread.loadFailed'))
    }
    finally { refreshing.value = false }
  }

  watch(() => { const c = thread(); return c && `${c.roomId}/${c.eventId}` }, () => loadMessages(true), { immediate: true })

  let timer: ReturnType<typeof setInterval> | undefined
  const onVisible = () => { if (document.visibilityState === 'visible' && thread()) loadMessages(true) }
  onMounted(() => {
    timer = setInterval(onVisible, 30_000)
    document.addEventListener('visibilitychange', onVisible)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  })

  const reply = ref('')
  const sending = ref(false)
  // One id per written message, kept until it is sent, so a retry does not post twice.
  let replyId: string | null = null
  watch(reply, () => { replyId = null })

  async function send() {
    const text = reply.value.trim()
    if (!text || sending.value) return
    replyId ??= crypto.randomUUID()
    sending.value = true
    try {
      const sent = await api<MatrixThreadMessage>(`/api/cards/${cd.cardId.value}/matrix-thread/messages`, { method: 'POST', body: { text, clientId: replyId } })
      reply.value = ''
      replyId = null
      if (view.value) view.value.messages.push(sent)
      loadMessages(true)
    }
    catch (err) { showError(err, t('matrix.thread.sendFailed')) }
    finally { sending.value = false }
  }

  return { view, loadError, refreshing, loadMessages, reply, sending, send }
}

export type MatrixThreadApi = ReturnType<typeof useMatrixThread>
