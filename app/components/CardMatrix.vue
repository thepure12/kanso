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
const confirm = useConfirm()

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
        <UButton v-if="canEdit" size="xs" color="neutral" variant="ghost" icon="i-lucide-unlink" :label="t('matrix.thread.unlink')" :loading="busy" @click="unlink" />
      </div>
      <UAlert v-if="thread.roomId !== room.roomId" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :description="t('matrix.thread.otherRoom')" />
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
