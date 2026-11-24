<script setup lang="ts">
import type { CustomView, ViewColumn } from '#shared/types/customViews'
import { CUSTOM_VIEW_MAX_COLUMNS } from '#shared/customViews'

// Creates a custom view or edits one: name plus columns from any boards, in order.
const props = defineProps<{ view?: CustomView | null }>()
const emit = defineEmits<{ saved: [view: CustomView] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const showError = useApiError()

const name = ref('')
const columnIds = ref<string[]>([])
const saving = ref(false)
const nameError = ref<string>()
const available = ref<ViewColumn[]>([])
const loading = ref(false)

watch(open, async (o) => {
  if (!o) return
  name.value = props.view?.name ?? ''
  columnIds.value = props.view?.columns.map(c => c.columnId) ?? []
  nameError.value = undefined
  loading.value = true
  try { available.value = await $fetch<ViewColumn[]>('/api/views/columns') }
  catch (err) { showError(err, t('customViews.errors.columns')) }
  finally { loading.value = false }
}, { immediate: true })

// Known columns: the pickable ones plus those already in the view (e.g. on an archived board).
const byId = computed(() => new Map([...(props.view?.columns ?? []), ...available.value].map(c => [c.columnId, c])))
const selected = computed(() => columnIds.value.flatMap(id => byId.value.get(id) ?? []))

// Grouped by board for the picker.
interface PickerItem { type?: 'label', label: string, description?: string, value?: string }
const items = computed((): PickerItem[][] => {
  const groups = new Map<string, ViewColumn[]>()
  for (const c of available.value) {
    const list = groups.get(c.boardId) ?? []
    list.push(c)
    groups.set(c.boardId, list)
  }
  return [...groups.values()].map(cols => [
    { type: 'label' as const, label: cols[0]!.boardName },
    ...cols.map(c => ({ label: c.title, description: c.boardName, value: c.columnId })),
  ])
})

function move(index: number, by: -1 | 1) {
  const ids = [...columnIds.value]
  const [id] = ids.splice(index, 1)
  ids.splice(index + by, 0, id!)
  columnIds.value = ids
}
function remove(index: number) {
  columnIds.value = columnIds.value.filter((_, i) => i !== index)
}

async function save() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  saving.value = true
  nameError.value = undefined
  try {
    const body = { name: trimmed, columnIds: columnIds.value }
    const view = props.view
      ? await $fetch<CustomView>(`/api/views/${props.view.id}`, { method: 'PATCH', body })
      : await $fetch<CustomView>('/api/views', { method: 'POST', body })
    open.value = false
    emit('saved', view)
  }
  catch (err) {
    if (isNameTaken(err)) nameError.value = t('customViews.nameTaken')
    else showError(err, t('customViews.errors.save'))
  }
  finally { saving.value = false }
}
</script>

<template>
  <UModal v-model:open="open" :title="view ? t('customViews.edit') : t('customViews.new')" :description="t('customViews.description')">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField :label="t('customViews.name')" :error="nameError">
          <UInput v-model="name" :placeholder="t('customViews.namePlaceholder')" maxlength="100" class="w-full" autofocus />
        </UFormField>
        <UFormField :label="t('customViews.columns')" :description="t('customViews.columnsHelp')">
          <USelectMenu
            v-model="columnIds"
            :items="items"
            value-key="value"
            multiple
            :filter-fields="['label', 'description']"
            :loading="loading"
            :placeholder="t('customViews.pickColumns')"
            :search-input="{ placeholder: t('customViews.searchColumns') }"
            :reset-search-term-on-select="false"
            class="w-full"
            data-testid="view-column-picker"
          >
            <template #default>
              {{ t('customViews.columnCount', {}, columnIds.length) }}
            </template>
          </USelectMenu>
        </UFormField>
        <ol v-if="selected.length" class="space-y-1" data-testid="view-columns">
          <li v-for="(c, i) in selected" :key="c.columnId" class="flex items-center gap-2 rounded-md border border-default px-2 py-1 text-sm">
            <span class="size-2.5 shrink-0 rounded-full" :style="{ background: c.color ?? 'var(--ui-border-accented)' }" />
            <span class="min-w-0 flex-1 truncate">
              <span class="font-medium">{{ c.title }}</span>
              <span class="text-muted"> · {{ c.boardName }}</span>
            </span>
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :disabled="i === 0" :aria-label="t('customViews.moveUp')" @click="move(i, -1)" />
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :disabled="i === selected.length - 1" :aria-label="t('customViews.moveDown')" @click="move(i, 1)" />
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('customViews.removeColumn')" @click="remove(i)" />
          </li>
        </ol>
        <p v-if="columnIds.length >= CUSTOM_VIEW_MAX_COLUMNS" class="text-sm text-warning">
          {{ t('customViews.tooMany', { max: CUSTOM_VIEW_MAX_COLUMNS }) }}
        </p>
        <div class="flex justify-end">
          <UButton type="submit" :label="view ? t('common.save') : t('customViews.create')" :loading="saving" :disabled="!name.trim() || columnIds.length > CUSTOM_VIEW_MAX_COLUMNS" />
        </div>
      </form>
    </template>
  </UModal>
</template>
