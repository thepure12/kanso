<script setup lang="ts">
import type { BoardMatrixRoom, CardMatrixThread, MatrixThreadMessage, MatrixThreadView } from '#shared/types/matrix'

const props = defineProps<{
  room: BoardMatrixRoom
  /** undefined while the card is loading. */
  thread: CardMatrixThread | null | undefined
  canEdit: boolean
  cd: CardDetailApi
}>()
const { t, locale } = useI18n()
const confirm = useConfirm()
const showError = useApiError()

/** The thread's messages, read from Matrix while this tab is shown (every 30 s, and when the tab becomes visible again). */
const view = ref<MatrixThreadView | null>(null)
const loadError = ref<string | null>(null)
const refreshing = ref(false)
let loadedFor: string | null = null

async function loadMessages(quiet = false) {
  const thread = props.thread
  if (!thread) {
    view.value = null
    loadedFor = null
    return
  }
  const key = `${thread.roomId}/${thread.eventId}`
  if (loadedFor !== key) view.value = null
  refreshing.value = true
  try {
    view.value = await api<MatrixThreadView>(`/api/cards/${props.cd.cardId.value}/matrix-thread`)
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

watch(() => props.thread && `${props.thread.roomId}/${props.thread.eventId}`, () => loadMessages(true), { immediate: true })

let timer: ReturnType<typeof setInterval> | undefined
const onVisible = () => { if (document.visibilityState === 'visible' && props.thread) loadMessages(true) }
onMounted(() => {
  timer = setInterval(onVisible, 30_000)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisible)
})

const htmlOf = (html: string) => import.meta.client ? sanitizeHtml(html) : ''

/** Reply box: the bot posts it into the thread with the writer's name. */
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
    const sent = await api<MatrixThreadMessage>(`/api/cards/${props.cd.cardId.value}/matrix-thread/messages`, { method: 'POST', body: { text, clientId: replyId } })
    reply.value = ''
    replyId = null
    if (view.value) view.value.messages.push(sent)
    loadMessages(true)
  }
  catch (err) { showError(err, t('matrix.thread.sendFailed')) }
  finally { sending.value = false }
}

const busy = ref(false)
const linking = ref(false)
const linkInput = ref('')

async function start() {
  busy.value = true
  try { await props.cd.linkMatrixThread() }
  finally { busy.value = false }
}

async function link() {
  if (!linkInput.value.trim()) return
  busy.value = true
  try {
    await props.cd.linkMatrixThread(linkInput.value.trim())
    if (props.thread) {
      linking.value = false
      linkInput.value = ''
    }
  }
  finally { busy.value = false }
}

async function unlink() {
  if (!await confirm({ title: t('matrix.thread.unlinkConfirm'), confirmLabel: t('matrix.thread.unlink') })) return
  busy.value = true
  try { await props.cd.unlinkMatrixThread() }
  finally { busy.value = false }
}

const threadLink = computed(() => props.thread
  ? `https://matrix.to/#/${encodeURIComponent(props.thread.roomId)}/${encodeURIComponent(props.thread.eventId)}`
  : null)
const roomLabel = computed(() => props.room.roomName ?? props.room.roomId)
</script>

<template>
  <div class="space-y-3 pt-2">
    <USkeleton v-if="thread === undefined" class="h-10 w-full" />

    <template v-else-if="thread">
      <div class="flex flex-wrap items-center gap-2">
        <p class="flex-1 text-sm text-muted">
          {{ t('matrix.thread.linked', { room: roomLabel }) }}
        </p>
        <UButton
          :to="threadLink!"
          target="_blank"
          rel="noopener"
          external
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-external-link"
          :label="t('matrix.thread.open')"
        />
        <UTooltip :text="t('matrix.thread.refresh')">
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :aria-label="t('matrix.thread.refresh')" :loading="refreshing" @click="loadMessages()" />
        </UTooltip>
        <UButton v-if="canEdit" size="xs" color="neutral" variant="ghost" icon="i-lucide-unlink" :label="t('matrix.thread.unlink')" :loading="busy" @click="unlink" />
      </div>
      <UAlert v-if="thread.roomId !== room.roomId" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :description="t('matrix.thread.otherRoom')" />

      <UAlert v-if="loadError && !view" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('matrix.thread.loadFailed')" :description="loadError" />
      <div v-else-if="!view" class="space-y-3">
        <USkeleton v-for="i in 3" :key="i" class="h-12 w-full" />
      </div>
      <template v-else>
        <p v-if="view.more" class="text-xs text-muted">
          {{ t('matrix.thread.more') }}
        </p>
        <ul class="space-y-1">
          <li
            v-for="(m, i) in view.messages"
            :key="m.id"
            class="-mx-2 flex gap-3 rounded-md px-2 py-1.5"
            :class="i === 0 && m.id === view.eventId ? 'mb-2 border-b border-default pb-3' : ''"
          >
            <UAvatar :alt="m.senderName" size="sm" class="shrink-0" :icon="m.fromBot && !m.kansoAuthorId ? 'i-lucide-bot' : undefined" />
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-x-2 text-xs">
                <UTooltip :text="m.sender">
                  <span class="font-medium">{{ m.senderName }}</span>
                </UTooltip>
                <UBadge v-if="m.fromBot" :label="m.kansoAuthorId ? t('matrix.thread.viaKanso') : t('matrix.thread.bot')" color="neutral" variant="subtle" size="sm" />
                <span class="text-muted">{{ formatDateTime(m.createdAt, locale) }}</span>
                <span v-if="m.edited" class="text-dimmed">{{ t('comments.edited') }}</span>
              </div>
              <!-- Sanitized by DOMPurify in sanitizeHtml. -->
              <div v-if="m.html && htmlOf(m.html)" class="markdown text-sm break-words" v-html="htmlOf(m.html)" />
              <p v-else class="whitespace-pre-wrap break-words text-sm">
                {{ m.body }}
              </p>
            </div>
          </li>
        </ul>
        <p v-if="view.messages.length <= 1" class="text-sm text-muted">
          {{ t('matrix.thread.noReplies') }}
        </p>
        <form v-if="canEdit && thread.roomId === room.roomId" class="space-y-2" @submit.prevent="send">
          <UTextarea
            v-model="reply"
            :placeholder="t('matrix.thread.replyPlaceholder')"
            :rows="2"
            autoresize
            :maxrows="10"
            maxlength="10000"
            class="w-full"
          />
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs text-muted">
              {{ t('matrix.thread.replyHint', { bot: room.botUserId }) }}
            </p>
            <UButton type="submit" size="sm" icon="i-lucide-send" :label="t('matrix.thread.send')" :loading="sending" :disabled="!reply.trim()" />
          </div>
        </form>
      </template>
    </template>

    <template v-else>
      <p class="text-sm text-muted">
        {{ t('matrix.thread.none', { room: roomLabel }) }}
      </p>
      <div v-if="canEdit" class="space-y-2">
        <div class="flex flex-wrap gap-2">
          <UButton size="sm" icon="i-lucide-message-square-plus" :label="t('matrix.thread.start')" :loading="busy && !linking" :disabled="busy" @click="start" />
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-link" :label="t('matrix.thread.linkExisting')" :disabled="busy" @click="linking = !linking" />
        </div>
        <form v-if="linking" class="flex gap-2" @submit.prevent="link">
          <UInput v-model="linkInput" class="flex-1 font-mono" :placeholder="t('matrix.thread.linkPlaceholder')" maxlength="1000" autofocus />
          <UButton type="submit" size="sm" :label="t('matrix.thread.linkSubmit')" :loading="busy" :disabled="!linkInput.trim()" />
        </form>
        <p v-if="linking" class="text-xs text-muted">
          {{ t('matrix.thread.linkHelp') }}
        </p>
      </div>
    </template>
  </div>
</template>
