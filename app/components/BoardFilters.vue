<script setup lang="ts">
import { priorities, type BoardField, type Member, type Tag } from '#shared/types/board'

const props = defineProps<{ tags: Tag[], fields: BoardField[], members: Member[], shown: number, total: number }>()
const filter = defineModel<CardFilter>({ required: true })
const { t } = useI18n()

const active = computed(() => isFilterActive(filter.value))

const search = useTemplateRef<{ inputRef: HTMLInputElement | null }>('search')
defineExpose({ focus: () => search.value?.inputRef?.focus() })

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
function setFieldFilter(fieldId: string, keys: string[]) {
  filter.value = { ...filter.value, fields: { ...filter.value.fields, [fieldId]: keys } }
}

const dueItems = computed(() => (['any', 'overdue', 'today', 'week', 'none', 'started', 'upcoming'] as const)
  .map(value => ({ label: t(`filters.due.${value}`), value })))
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UInput
      ref="search"
      v-model="filter.text"
      icon="i-lucide-search"
      :placeholder="t('filters.search')"
      class="w-48"
      :aria-label="t('filters.search')"
      @keydown.esc="filter.text = ''"
    />
    <USelectMenu
      v-model="filter.tagIds"
      :items="props.tags"
      value-key="id"
      label-key="name"
      multiple
      :placeholder="t('filters.tags')"
      icon="i-lucide-tag"
      class="w-40"
      :search-input="false"
    >
      <template #item-leading="{ item }">
        <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
      </template>
    </USelectMenu>
    <USelectMenu v-model="filter.assigneeIds" :items="memberItems" value-key="value" multiple :placeholder="t('filters.assignees')" icon="i-lucide-user" class="w-40" />
    <USelectMenu v-model="filter.priorities" :items="priorityItems" value-key="value" multiple :placeholder="t('filters.priority')" icon="i-lucide-flag" class="w-36" :search-input="false" />
    <USelect v-model="filter.due" :items="dueItems" icon="i-lucide-calendar" class="w-40" />
    <USelectMenu
      v-for="{ field, items } in fieldFilters"
      :key="field.id"
      :model-value="filter.fields[field.id] ?? []"
      :items="items"
      value-key="value"
      multiple
      :placeholder="field.name"
      :icon="fieldKindMeta[field.kind].icon"
      class="w-40"
      :search-input="false"
      @update:model-value="(keys: string[]) => setFieldFilter(field.id, keys)"
    >
      <template #item-leading="{ item }">
        <span v-if="item.color" class="size-3 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
      </template>
    </USelectMenu>
    <template v-if="active">
      <span class="text-sm text-muted">{{ t('filters.shown', { shown: props.shown, total: props.total }, props.total) }}</span>
      <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :label="t('common.clear')" @click="filter = emptyFilter()" />
    </template>
  </div>
</template>
