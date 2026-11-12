<script setup lang="ts">
import { priorities, type BoardField, type Member, type Tag } from '#shared/types/board'

const props = defineProps<{ tags: Tag[], fields: BoardField[], members: Member[], shown: number, total: number }>()
const filter = defineModel<CardFilter>({ required: true })
const { t } = useI18n()

const active = computed(() => isFilterActive(filter.value))
// Filters set in the panel (the search box sits outside it).
const panelCount = computed(() => {
  const f = filter.value
  return [f.tagIds.length, f.assigneeIds.length, f.priorities.length, f.due !== 'any', ...Object.values(f.fields).map(v => v.length)]
    .filter(Boolean).length
})

// The search box stays collapsed to an icon until opened (click or `/`), and
// collapses again when it loses focus while empty.
const search = useTemplateRef<{ inputRef: HTMLInputElement | null }>('search')
const searchOpen = ref(!!filter.value.text)
async function openSearch() {
  searchOpen.value = true
  await nextTick()
  search.value?.inputRef?.focus()
}
function closeSearchIfEmpty() {
  if (!filter.value.text.trim()) searchOpen.value = false
}
function onSearchEscape() {
  filter.value.text = ''
  searchOpen.value = false
}
watch(() => filter.value.text, v => { if (v) searchOpen.value = true })
defineExpose({ focus: openSearch })

const memberItems = computed(() => [
  { label: t('filters.unassigned'), value: 'none', icon: 'i-lucide-user-x' },
  ...props.members.map(m => ({ label: m.name, value: m.userId, avatar: { src: m.avatarUrl ?? undefined, alt: m.name } })),
])
const priorityItems = computed(() => [
  ...priorities.map(p => ({ label: t(`priority.${p}`), value: p, icon: priorityMeta[p].icon })),
  { label: t('filters.noPriority'), value: 'none', icon: 'i-lucide-minus' },
])
// Select and checkbox fields, with values as in fieldFilterKey.
const fieldFilters = computed(() => props.fields.filter(isFilterableField).map(f => ({
  field: f,
  items: f.kind === 'checkbox'
    ? [{ label: t('filters.checked'), value: 'true', color: undefined }, { label: t('filters.notChecked'), value: 'none', color: undefined }]
    : [...f.options.map(o => ({ label: o.label, value: o.id, color: o.color as string | undefined })), { label: t('filters.noValue'), value: 'none', color: undefined }],
})))
// Resets what the panel sets; the search text stays.
function clearPanel() {
  filter.value = { ...emptyFilter(), text: filter.value.text }
}
function setFieldFilter(fieldId: string, keys: string[]) {
  filter.value = { ...filter.value, fields: { ...filter.value.fields, [fieldId]: keys } }
}

const dueItems = computed(() => (['any', 'overdue', 'today', 'week', 'none', 'started', 'upcoming'] as const)
  .map(value => ({ label: t(`filters.due.${value}`), value })))
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UPopover :content="{ align: 'start' }">
      <UButton icon="i-lucide-list-filter" color="neutral" :variant="panelCount ? 'soft' : 'outline'" :label="t('filters.button')">
        <template v-if="panelCount" #trailing>
          <UBadge :label="String(panelCount)" size="sm" variant="solid" />
        </template>
      </UButton>
      <template #content>
        <div class="p-4 w-72 flex flex-col gap-3">
          <UFormField :label="t('filters.tags')">
            <USelectMenu
              v-model="filter.tagIds"
              :items="props.tags"
              value-key="id"
              label-key="name"
              multiple
              :placeholder="t('filters.any')"
              icon="i-lucide-tag"
              class="w-full"
              :search-input="false"
            >
              <template #item-leading="{ item }">
                <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
              </template>
            </USelectMenu>
          </UFormField>
          <UFormField :label="t('filters.assignees')">
            <USelectMenu v-model="filter.assigneeIds" :items="memberItems" value-key="value" multiple :placeholder="t('filters.any')" icon="i-lucide-user" class="w-full" />
          </UFormField>
          <UFormField :label="t('filters.priority')">
            <USelectMenu v-model="filter.priorities" :items="priorityItems" value-key="value" multiple :placeholder="t('filters.any')" icon="i-lucide-flag" class="w-full" :search-input="false" />
          </UFormField>
          <UFormField :label="t('filters.dueLabel')">
            <USelect v-model="filter.due" :items="dueItems" icon="i-lucide-calendar" class="w-full" />
          </UFormField>
          <UFormField v-for="{ field, items } in fieldFilters" :key="field.id" :label="field.name">
            <USelectMenu
              :model-value="filter.fields[field.id] ?? []"
              :items="items"
              value-key="value"
              multiple
              :placeholder="t('filters.any')"
              :icon="fieldKindMeta[field.kind].icon"
              class="w-full"
              :search-input="false"
              @update:model-value="(keys: string[]) => setFieldFilter(field.id, keys)"
            >
              <template #item-leading="{ item }">
                <span v-if="item.color" class="size-3 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
              </template>
            </USelectMenu>
          </UFormField>
          <UButton
            v-if="panelCount"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            class="self-end"
            :label="t('filters.clearPanel')"
            @click="clearPanel"
          />
        </div>
      </template>
    </UPopover>
    <UInput
      v-if="searchOpen"
      ref="search"
      v-model="filter.text"
      icon="i-lucide-search"
      :placeholder="t('filters.search')"
      class="w-48"
      :aria-label="t('filters.search')"
      @blur="closeSearchIfEmpty"
      @keydown.esc="onSearchEscape"
    />
    <UTooltip v-else :text="t('filters.search')">
      <UButton icon="i-lucide-search" color="neutral" variant="ghost" :aria-label="t('filters.search')" @click="openSearch" />
    </UTooltip>
    <template v-if="active">
      <span class="text-sm text-muted">{{ t('filters.shown', { shown: props.shown, total: props.total }, props.total) }}</span>
      <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :label="t('common.clear')" @click="filter = emptyFilter()" />
    </template>
  </div>
</template>
