<script setup lang="ts">
import type { BoardMatrixRoom, CardMatrixThread } from '#shared/types/matrix'

const props = defineProps<{
  room: BoardMatrixRoom
  /** undefined while the card is loading. */
  thread: CardMatrixThread | null | undefined
  canEdit: boolean
  cd: CardDetailApi
}>()
const { t } = useI18n()

const mt = useMatrixThread(props.cd, () => props.thread)
const { view, reply, sending, send } = mt
const canReply = computed(() => props.canEdit && props.thread?.roomId === props.room.roomId)
</script>

<template>
  <div class="space-y-3 pt-2">
    <MatrixThreadBar :room="room" :thread="thread" :can-edit="canEdit" :cd="cd" :mt="mt">
      <UTooltip :text="t('card.conversation.merge')">
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-merge" :aria-label="t('card.conversation.merge')" @click="setCardConversationMerged(true)" />
      </UTooltip>
    </MatrixThreadBar>

    <template v-if="thread && !(mt.loadError.value && !view)">
      <div v-if="!view" class="space-y-3">
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
            <MatrixMessageItem :message="m" />
          </li>
        </ul>
        <p v-if="view.messages.length <= 1" class="text-sm text-muted">
          {{ t('matrix.thread.noReplies') }}
        </p>
        <form v-if="canReply" class="space-y-2" @submit.prevent="send">
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
        <MatrixAccountBox v-if="canReply" :room="room" :mt="mt" />
      </template>
    </template>
  </div>
</template>
