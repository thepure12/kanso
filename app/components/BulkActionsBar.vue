<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { priorities, type BulkCardAction, type Column, type Member, type Tag } from '#shared/types/board'

const props = defineProps<{
  count: number
  columns: Column[]
  tags: Tag[]
  members: Member[]
}>()
const emit = defineEmits<{ apply: [action: BulkCardAction], clear: [] }>()
const { t } = useI18n()

const moveItems = computed<DropdownMenuItem[][]>(() => [
  props.columns.map(c => ({ label: c.title, onSelect: () => emit('apply', { columnId: c.id }) })),
])

/** Add / remove submenus per tag or person. */
function addRemove(label: string, add: BulkCardAction, remove: BulkCardAction): DropdownMenuItem {
  return {
    label,
    children: [[
      { label: t('board.bulk.add'), icon: 'i-lucide-plus', onSelect: () => emit('apply', add) },
      { label: t('board.bulk.remove'), icon: 'i-lucide-minus', onSelect: () => emit('apply', remove) },
    ]],
  }
}
const tagItems = computed<DropdownMenuItem[][]>(() => [
  props.tags.map(tag => ({ ...addRemove(tag.name, { addTagIds: [tag.id] }, { removeTagIds: [tag.id] }), icon: 'i-lucide-tag' })),
])
const assigneeItems = computed<DropdownMenuItem[][]>(() => [
  props.members.map(m => ({ ...addRemove(m.name, { addAssigneeIds: [m.userId] }, { removeAssigneeIds: [m.userId] }), avatar: { src: m.avatarUrl ?? undefined, alt: m.name } })),
])
const priorityItems = computed<DropdownMenuItem[][]>(() => [
  priorities.map(p => ({ label: t(`priority.${p}`), icon: priorityMeta[p].icon, onSelect: () => emit('apply', { priority: p }) })),
  [{ label: t('board.bulk.noPriority'), icon: 'i-lucide-x', onSelect: () => emit('apply', { priority: null }) }],
])

const dueOpen = ref(false)
const due = ref('')
function setDue(value: string | null) {
  dueOpen.value = false
  emit('apply', { dueDate: value })
}
</script>

<template>
  <div
    role="toolbar"
    :aria-label="t('board.bulk.toolbar')"
    class="fixed z-40 bottom-4 inset-x-0 mx-auto w-fit max-w-[calc(100vw-2rem)] flex flex-wrap items-center gap-1 rounded-lg bg-default ring ring-default shadow-lg px-3 py-2"
  >
    <span class="text-sm font-medium me-2">{{ t('board.bulk.selected', { n: props.count }, props.count) }}</span>
    <UDropdownMenu :items="moveItems">
      <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-right-left" :label="t('board.bulk.move')" />
    </UDropdownMenu>
    <UDropdownMenu v-if="props.tags.length" :items="tagItems">
      <UButton color="neutral" variant="ghost" icon="i-lucide-tags" :label="t('board.bulk.tags')" />
    </UDropdownMenu>
    <UDropdownMenu :items="assigneeItems">
      <UButton color="neutral" variant="ghost" icon="i-lucide-user-plus" :label="t('board.bulk.assignees')" />
    </UDropdownMenu>
    <UDropdownMenu :items="priorityItems">
      <UButton color="neutral" variant="ghost" icon="i-lucide-flag" :label="t('board.bulk.priority')" />
    </UDropdownMenu>
    <UPopover v-model:open="dueOpen">
      <UButton color="neutral" variant="ghost" icon="i-lucide-calendar" :label="t('board.bulk.dueDate')" />
      <template #content>
        <form class="p-3 flex items-center gap-2" @submit.prevent="due && setDue(due)">
          <UInput v-model="due" type="date" :aria-label="t('board.bulk.dueDate')" />
          <UButton type="submit" :label="t('board.bulk.set')" :disabled="!due" />
          <UButton color="neutral" variant="outline" :label="t('board.bulk.clearDue')" @click="setDue(null)" />
        </form>
      </template>
    </UPopover>
    <UButton color="neutral" variant="ghost" icon="i-lucide-archive" :label="t('board.bulk.archive')" @click="emit('apply', { archived: true })" />
    <UTooltip :text="t('board.bulk.clear')">
      <UButton color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('board.bulk.clear')" @click="emit('clear')" />
    </UTooltip>
  </div>
</template>
