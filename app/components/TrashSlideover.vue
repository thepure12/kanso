<script setup lang="ts">
import type { Column, TrashedCard } from '#shared/types/board'

const props = defineProps<{
  boardId: string
  columns: Column[]
  /** Changes when the board reloads, so the list refetches. */
  version: number
  restore: (cardId: string) => Promise<unknown>
}>()
const open = defineModel<boolean>('open', { required: true })
const showError = useApiError()
const { t, locale } = useI18n()
const confirm = useConfirm()

const cards = ref<TrashedCard[] | null>(null)
async function load() {
  try { cards.value = await api<TrashedCard[]>(`/api/boards/${props.boardId}/trash`) }
  catch (err) { showError(err, t('trash.loadFailed')) }
}
watch(() => [open.value, props.version] as const, ([isOpen]) => { if (isOpen) load() }, { immediate: true })

const columnTitle = (id: string) => props.columns.find(c => c.id === id)?.title ?? ''
function meta(c: TrashedCard) {
  const when = formatDateTime(c.deletedAt, locale.value)
  const deleted = c.deletedBy ? t('trash.deletedBy', { name: c.deletedBy, date: when }) : t('trash.deletedAt', { date: when })
  return [c.isTemplate ? t('trash.template') : columnTitle(c.columnId), deleted].filter(Boolean).join(' · ')
}

async function restore(c: TrashedCard) {
  cards.value = cards.value?.filter(x => x.id !== c.id) ?? null
  await props.restore(c.id)
}

async function purge(c: TrashedCard) {
  if (!await confirm({ title: t('trash.purgeConfirm', { title: c.title }), confirmLabel: t('trash.purge') })) return
  try {
    await api(`/api/boards/${props.boardId}/trash/${c.id}`, { method: 'DELETE' })
    cards.value = cards.value?.filter(x => x.id !== c.id) ?? null
  }
  catch (err) { showError(err, t('trash.purgeFailed')); load() }
}

async function empty() {
  if (!await confirm({ title: t('trash.emptyConfirm', { n: cards.value?.length ?? 0 }, cards.value?.length ?? 0), confirmLabel: t('trash.empty') })) return
  try {
    await api(`/api/boards/${props.boardId}/trash`, { method: 'DELETE' })
    cards.value = []
  }
  catch (err) { showError(err, t('trash.purgeFailed')); load() }
}
</script>

<template>
  <USlideover v-model:open="open" :title="t('trash.title')" :description="t('trash.description')">
    <template #body>
      <USkeleton v-if="!cards" class="h-16 w-full" />
      <p v-else-if="!cards.length" class="text-sm text-muted">
        {{ t('trash.none') }}
      </p>
      <template v-else>
        <ul class="divide-y divide-default">
          <li v-for="c in cards" :key="c.id" class="flex items-center gap-2 py-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate">
                {{ c.title }}
              </p>
              <p class="text-xs text-muted">
                {{ meta(c) }}
              </p>
            </div>
            <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-undo-2" :label="t('trash.restore')" @click="restore(c)" />
            <UTooltip :text="t('trash.purge')">
              <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash" :aria-label="t('trash.purge')" @click="purge(c)" />
            </UTooltip>
          </li>
        </ul>
        <UButton class="mt-4" color="error" variant="outline" icon="i-lucide-trash-2" :label="t('trash.empty')" @click="empty" />
      </template>
    </template>
  </USlideover>
</template>
