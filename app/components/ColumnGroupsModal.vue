<script setup lang="ts">
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { Column, ColumnGroup } from '#shared/types/board'

const props = defineProps<{ columns: Column[] }>()
const emit = defineEmits<{
  create: [group: Pick<ColumnGroup, 'name' | 'color' | 'columnIds'>]
  update: [group: ColumnGroup, patch: Partial<Pick<ColumnGroup, 'name' | 'color' | 'columnIds'>>]
  /** A group was dragged to `index` (the list is already reordered). */
  move: [index: number]
  delete: [group: ColumnGroup]
}>()
const open = defineModel<boolean>('open', { required: true })
// The board's groups, also the v-model for drag and drop.
const list = defineModel<ColumnGroup[]>('groups', { required: true })
const { t } = useI18n()
const confirm = useConfirm()

function onDrop(e: SortableEvent) {
  nextTick(() => emit('move', e.newIndex!))
}

const columnItems = computed(() => props.columns.map(c => ({ label: c.title, value: c.id })))

const randomPreset = () => colorPresets[Math.floor(Math.random() * colorPresets.length)]!
const draft = reactive({ name: '', color: randomPreset(), columnIds: [] as string[] })

function create() {
  const name = draft.name.trim()
  if (!name) return
  emit('create', { name, color: draft.color, columnIds: draft.columnIds })
  Object.assign(draft, { name: '', color: randomPreset(), columnIds: [] })
}

function rename(group: ColumnGroup, e: Event) {
  const input = e.target as HTMLInputElement
  const name = input.value.trim()
  if (!name) input.value = group.name
  else if (name !== group.name) emit('update', group, { name })
}

async function remove(group: ColumnGroup) {
  if (await confirm({ title: t('columnGroups.confirmDelete', { name: group.name }), confirmLabel: t('common.delete') })) emit('delete', group)
}

// Colour being edited in a popover: a group's id, or 'new' for the draft.
const picking = ref<{ id: string, color: string } | null>(null)

function setPicking(id: string, color: string, isOpen: boolean) {
  if (isOpen) {
    picking.value = { id, color }
    return
  }
  const p = picking.value
  picking.value = null
  if (!p || p.id !== id) return
  if (id === 'new') {
    draft.color = p.color
    return
  }
  const group = list.value.find(g => g.id === id)
  if (group && group.color !== p.color) emit('update', group, { color: p.color })
}
const swatch = (id: string, color: string | null) => picking.value?.id === id ? picking.value.color : color ?? 'var(--ui-bg-accented)'
</script>

<template>
  <UModal v-model:open="open" :title="t('columnGroups.title')" :description="t('columnGroups.description')">
    <template #body>
      <div class="space-y-2">
        <p v-if="!list.length" class="text-sm text-muted">
          {{ t('columnGroups.empty') }}
        </p>
        <VueDraggable v-model="list" handle=".group-handle" :animation="150" class="space-y-3" @update="onDrop">
          <div v-for="group in list" :key="group.id" class="flex flex-wrap items-center gap-2">
            <UIcon name="i-lucide-grip-vertical" class="group-handle size-4 cursor-grab text-dimmed shrink-0" />
            <UPopover :open="picking?.id === group.id" @update:open="v => setPicking(group.id, group.color ?? randomPreset(), v)">
              <button
                type="button"
                class="size-8 shrink-0 rounded-md ring ring-default"
                :style="{ backgroundColor: swatch(group.id, group.color) }"
                :aria-label="t('views.changeColour', { name: group.name })"
              />
              <template #content>
                <div v-if="picking" class="p-4 w-72">
                  <ColorField v-model="picking.color" />
                </div>
              </template>
            </UPopover>
            <UInput :key="group.name" :default-value="group.name" :maxlength="50" class="flex-1 min-w-32" :aria-label="t('columnGroups.nameOf', { name: group.name })" @change="rename(group, $event)" />
            <USelectMenu
              :model-value="group.columnIds"
              :items="columnItems"
              value-key="value"
              multiple
              :search-input="false"
              :placeholder="t('columnGroups.pickColumns')"
              class="w-48"
              :aria-label="t('columnGroups.columnsOf', { name: group.name })"
              @update:model-value="(ids: string[]) => emit('update', group, { columnIds: ids })"
            >
              <template #default>
                <span class="truncate">{{ t('columnGroups.columnCount', { count: group.columnIds.length }, group.columnIds.length) }}</span>
              </template>
            </USelectMenu>
            <UTooltip :text="t('columnGroups.delete', { name: group.name })">
              <UButton icon="i-lucide-trash" color="error" variant="ghost" :aria-label="t('columnGroups.delete', { name: group.name })" @click="remove(group)" />
            </UTooltip>
          </div>
        </VueDraggable>

        <USeparator class="my-4" />

        <form class="flex flex-wrap items-center gap-2" @submit.prevent="create">
          <UPopover :open="picking?.id === 'new'" @update:open="v => setPicking('new', draft.color, v)">
            <button
              type="button"
              class="size-8 shrink-0 rounded-md ring ring-default"
              :style="{ backgroundColor: swatch('new', draft.color) }"
              :aria-label="t('columnGroups.newColour')"
            />
            <template #content>
              <div v-if="picking" class="p-4 w-72">
                <ColorField v-model="picking.color" />
              </div>
            </template>
          </UPopover>
          <UInput v-model="draft.name" :placeholder="t('columnGroups.newGroup')" :maxlength="50" class="flex-1 min-w-32" />
          <USelectMenu
            v-model="draft.columnIds"
            :items="columnItems"
            value-key="value"
            multiple
            :search-input="false"
            :placeholder="t('columnGroups.pickColumns')"
            class="w-48"
            :aria-label="t('columnGroups.newColumns')"
          >
            <template #default>
              <span v-if="draft.columnIds.length" class="truncate">{{ t('columnGroups.columnCount', { count: draft.columnIds.length }, draft.columnIds.length) }}</span>
              <span v-else class="text-dimmed truncate">{{ t('columnGroups.pickColumns') }}</span>
            </template>
          </USelectMenu>
          <UButton type="submit" icon="i-lucide-plus" :label="t('common.add')" :disabled="!draft.name.trim()" />
        </form>
      </div>
    </template>
  </UModal>
</template>
