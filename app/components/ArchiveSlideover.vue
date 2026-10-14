<script setup lang="ts">
import type { ArchivedCard, Column } from '#shared/types/board'

const props = defineProps<{
  boardId: string
  columns: Column[]
  canEdit: boolean
  /** Changes when the board reloads, so the list refetches. */
  version: number
  restore: (cardId: string) => Promise<unknown>
  remove: (cardId: string) => Promise<unknown>
}>()
const open = defineModel<boolean>('open', { required: true })
const showError = useApiError()
const { t, locale } = useI18n()

const cards = ref<ArchivedCard[] | null>(null)
async function load() {
  try { cards.value = await api<ArchivedCard[]>(`/api/boards/${props.boardId}/archived`) }
  catch (err) { showError(err, t('archive.loadFailed')) }
}
watch(() => [open.value, props.version] as const, ([isOpen]) => { if (isOpen) load() }, { immediate: true })

const columnTitle = (id: string) => props.columns.find(c => c.id === id)?.title ?? ''

async function restore(c: ArchivedCard) {
  cards.value = cards.value?.filter(x => x.id !== c.id) ?? null
  await props.restore(c.id)
}

async function remove(c: ArchivedCard) {
  if (!confirm(t('archive.deleteConfirm', { title: c.title }))) return
  cards.value = cards.value?.filter(x => x.id !== c.id) ?? null
  await props.remove(c.id)
}
</script>

<template>
  <USlideover v-model:open="open" :title="t('archive.title')" :description="t('archive.description')">
    <template #body>
      <USkeleton v-if="!cards" class="h-16 w-full" />
      <p v-else-if="!cards.length" class="text-sm text-muted">
        {{ t('archive.empty') }}
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="c in cards" :key="c.id" class="flex items-center gap-2 py-2">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate">
              {{ c.title }}
            </p>
            <p class="text-xs text-muted">
              {{ columnTitle(c.columnId) }} · {{ t('archive.archivedAt', { date: formatDateTime(c.archivedAt, locale) }) }}
            </p>
          </div>
          <template v-if="props.canEdit">
            <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-undo-2" :label="t('archive.restore')" @click="restore(c)" />
            <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash" :aria-label="t('board.deleteCard')" @click="remove(c)" />
          </template>
        </li>
      </ul>
    </template>
  </USlideover>
</template>
