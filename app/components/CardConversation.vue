<script setup lang="ts">
import type { Comment, Member } from '#shared/types/board'
import type { BoardMatrixRoom, CardMatrixThread, MatrixThreadMessage } from '#shared/types/matrix'

/**
 * Comments and the card's Matrix thread in one list, newest first or last
 * (useCommentOrder), with one composer that writes either a comment or a reply
 * in the thread (below the list when newest last).
 */
// Absent optional booleans would become false; undefined keeps the fallback.
const props = withDefaults(defineProps<{
  items: Comment[] | null
  /** Editing the card: linking the thread, replying in it, uploading files. */
  canEdit: boolean
  /** Writing comments (card editors and commenters); defaults to canEdit. */
  canComment?: boolean
  isOwner: boolean
  canReact: boolean
  cd: CardDetailApi
  members: Member[]
  room: BoardMatrixRoom
  /** undefined while the card is loading. */
  thread: CardMatrixThread | null | undefined
}>(), { canComment: undefined })
const { t } = useI18n()

const mt = useMatrixThread(props.cd, () => props.thread)
const { view, reply, sending, send } = mt
const canReply = computed(() => props.canEdit && props.thread?.roomId === props.room.roomId)
const commentable = computed(() => props.canComment ?? props.canEdit)

const order = useCommentOrder()

type Entry = { kind: 'comment', at: number, comment: Comment } | { kind: 'matrix', at: number, message: MatrixThreadMessage }

const entries = computed<Entry[]>(() => {
  const list: Entry[] = (props.items ?? []).map(c => ({ kind: 'comment', at: Date.parse(c.createdAt), comment: c }))
  // The thread is shown only while the card is still linked to it.
  if (props.thread && view.value) {
    for (const m of view.value.messages) list.push({ kind: 'matrix', at: Date.parse(m.createdAt), message: m })
  }
  return list.sort((a, b) => order.value === 'oldest' ? a.at - b.at : b.at - a.at)
})
const loadingThread = computed(() => !!props.thread && !view.value && !mt.loadError.value)

// Matrix by default while a reply is possible; the switch overrides it for this dialog.
const picked = ref<'comment' | 'matrix' | null>(null)
const target = computed({
  get: () => canReply.value ? picked.value ?? 'matrix' : 'comment',
  set: (v: 'comment' | 'matrix') => { picked.value = v },
})
const targetItems = computed(() => [
  { label: t('card.conversation.comment'), value: 'comment', icon: 'i-lucide-message-square' },
  { label: t('matrix.thread.tab'), value: 'matrix', icon: 'i-lucide-message-square-share' },
])

const draft = ref('')
async function postComment() {
  const body = draft.value.trim()
  if (!body) return
  draft.value = ''
  await props.cd.addComment(body)
}
</script>

<template>
  <div class="flex flex-col gap-4 pt-2">
    <div class="space-y-3">
      <MatrixThreadBar :room="room" :thread="thread" :can-edit="canEdit" :cd="cd" :mt="mt">
        <CommentOrderToggle />
        <UTooltip :text="t('card.conversation.split')">
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-split" :aria-label="t('card.conversation.split')" @click="setCardConversationMerged(false)" />
        </UTooltip>
      </MatrixThreadBar>
    </div>

    <div v-if="commentable || canReply" class="space-y-2" :class="order === 'oldest' ? 'order-1' : ''">
      <UTabs v-if="canReply" v-model="target" :items="targetItems" :content="false" size="xs" />
      <form v-if="target === 'comment'" class="space-y-2" @submit.prevent="postComment">
        <MarkdownEditor v-model="draft" :rows="3" :members="members" :upload="canEdit ? cd.upload : undefined" :placeholder="t('comments.placeholder')" />
        <div class="flex justify-end">
          <UButton type="submit" size="sm" :label="t('comments.submit')" :disabled="!draft.trim()" />
        </div>
      </form>
      <form v-else class="space-y-2" @submit.prevent="send">
        <UTextarea
          v-model="reply"
          :placeholder="t('matrix.thread.replyPlaceholder')"
          :rows="3"
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
    </div>

    <USkeleton v-if="!items" class="h-12 w-full" />
    <template v-else>
      <p v-if="!entries.length && !loadingThread" class="text-sm text-muted">
        {{ t('comments.empty') }}
      </p>
      <ul class="space-y-2">
        <template v-for="e in entries" :key="e.kind === 'comment' ? `c:${e.comment.id}` : `m:${e.message.id}`">
          <CommentItem
            v-if="e.kind === 'comment'"
            :comment="e.comment"
            :can-edit="commentable"
            :can-upload="canEdit"
            :is-owner="isOwner"
            :can-react="canReact"
            :cd="cd"
            :members="members"
          />
          <li v-else class="-mx-2 flex gap-3 rounded-md px-2 py-1.5">
            <MatrixMessageItem :message="e.message" show-source />
          </li>
        </template>
      </ul>
      <USkeleton v-if="loadingThread" class="h-12 w-full" />
      <p v-if="view?.more" class="text-xs text-muted">
        {{ t('matrix.thread.more') }}
      </p>
    </template>

    <MatrixAccountBox v-if="canReply && view" class="order-2" :room="room" :mt="mt" />
  </div>
</template>
