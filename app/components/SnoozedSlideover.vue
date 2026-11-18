<script setup lang="ts">
import type { Column, SnoozedCard } from '#shared/types/board'

const props = defineProps<{
  boardId: string
  columns: Column[]
  canEdit: boolean
  /** Changes when the board reloads, so the list refetches. */
  version: number
  wake: (cardId: string) => Promise<unknown>
}>()
const open = defineModel<boolean>('open', { required: true })
const showError = useApiError()
const { t, locale } = useI18n()

const cards = ref<SnoozedCard[] | null>(null)
async function load() {
  try { cards.value = await api<SnoozedCard[]>(`/api/boards/${props.boardId}/snoozed`) }
  catch (err) { showError(err, t('snooze.loadFailed')) }
}
watch(() => [open.value, props.version] as const, ([isOpen]) => { if (isOpen) load() }, { immediate: true })

const columnTitle = (id: string) => props.columns.find(c => c.id === id)?.title ?? ''

async function wake(c: SnoozedCard) {
  cards.value = cards.value?.filter(x => x.id !== c.id) ?? null
  await props.wake(c.id)
}
</script>

<template>
  <USlideover v-model:open="open" :title="t('snooze.title')" :description="t('snooze.description')">
    <template #body>
      <USkeleton v-if="!cards" class="h-16 w-full" />
      <p v-else-if="!cards.length" class="text-sm text-muted">
        {{ t('snooze.empty') }}
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="c in cards" :key="c.id" class="flex items-center gap-2 py-2">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate">
              {{ c.title }}
            </p>
            <p class="text-xs text-muted">
              {{ columnTitle(c.columnId) }} · {{ t('snooze.until', { date: formatDate(c.snoozedUntil, locale) }) }}
            </p>
          </div>
          <UButton v-if="props.canEdit" size="sm" color="neutral" variant="outline" icon="i-lucide-alarm-clock-off" :label="t('snooze.wake')" @click="wake(c)" />
        </li>
      </ul>
    </template>
  </USlideover>
</template>
