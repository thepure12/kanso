<script setup lang="ts">
import type { Card, CardRecurrence, Column } from '#shared/types/board'

const props = defineProps<{
  templates: Card[]
  recurrences: CardRecurrence[]
  columns: Column[]
  canEdit: boolean
}>()
const emit = defineEmits<{
  open: [template: Card]
  delete: [template: Card]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const confirm = useConfirm()
const i18n = useI18nContext()

const columnTitle = (id: string) => props.columns.find(c => c.id === id)?.title ?? ''
const recurrenceOf = (tpl: Card) => props.recurrences.find(r => r.templateId === tpl.id)

async function remove(tpl: Card) {
  if (await confirm({ title: t(recurrenceOf(tpl) ? 'templates.deleteConfirmRepeating' : 'templates.deleteConfirm', { title: tpl.title }), confirmLabel: t('common.delete') })) emit('delete', tpl)
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="t('templates.title')"
    :description="t('templates.description')"
  >
    <template #body>
      <p v-if="!props.templates.length" class="text-sm text-muted">
        {{ t('templates.empty') }}
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="tpl in props.templates" :key="tpl.id" class="flex items-center gap-2 py-2">
          <button type="button" class="min-w-0 flex-1 text-start cursor-pointer" @click="emit('open', tpl)">
            <p class="text-sm font-medium truncate">
              {{ tpl.title }}
            </p>
            <p class="text-xs text-muted flex items-center gap-1">
              <span>{{ columnTitle(tpl.columnId) }}</span>
              <template v-if="recurrenceOf(tpl)">
                · <UIcon name="i-lucide-repeat" class="shrink-0" />
                <span class="truncate">{{ describeRecurrence(recurrenceOf(tpl)!, i18n) }}{{ recurrenceOf(tpl)!.active ? '' : ` ${t('templates.paused')}` }}</span>
              </template>
            </p>
          </button>
          <UButton size="sm" color="neutral" variant="outline" :icon="props.canEdit ? 'i-lucide-pencil' : 'i-lucide-eye'" :label="props.canEdit ? t('common.edit') : t('templates.view')" @click="emit('open', tpl)" />
          <UTooltip v-if="props.canEdit" :text="t('templates.delete')">
            <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash" :aria-label="t('templates.delete')" @click="remove(tpl)" />
          </UTooltip>
        </li>
      </ul>
    </template>
  </USlideover>
</template>
