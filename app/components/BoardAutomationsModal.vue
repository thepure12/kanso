<script setup lang="ts">
import { boardAutomationKinds, priorities, type BoardAutomation, type BoardAutomationKind, type Column, type NewBoardAutomation, type Priority, type Tag } from '#shared/types/board'

const props = defineProps<{
  automations: BoardAutomation[]
  tags: Tag[]
  columns: Column[]
  canEdit: boolean
  /** Column preselected for a new automation (opened from a column's menu). */
  columnId?: string | null
}>()
const emit = defineEmits<{
  add: [automation: NewBoardAutomation]
  update: [automation: BoardAutomation, patch: { active: boolean }]
  delete: [automation: BoardAutomation]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t, locale } = useI18n()

const tagById = computed(() => new Map(props.tags.map(tag => [tag.id, tag])))

const icons: Record<BoardAutomationKind, string> = {
  archive_done: 'i-lucide-archive',
  tag_stale: 'i-lucide-tag',
  notify_stale: 'i-lucide-bell',
  raise_priority: 'i-lucide-arrow-up-circle',
  move_card: 'i-lucide-arrow-right-left',
}

const columnTitle = (id: string | null | undefined) => props.columns.find(c => c.id === id)?.title ?? '?'

function describe(a: BoardAutomation | NewBoardAutomation) {
  const column = columnTitle(a.columnId)
  // raise_priority has three forms: due today, within a day, within {n} days.
  if (a.kind === 'raise_priority') return t('automations.text.raise_priority', { n: a.days, priority: t(`priority.${a.priority}`) }, a.days)
  if (a.kind === 'move_card') return t('automations.text.move_card', { n: a.days, column, target: columnTitle(a.targetColumnId) }, a.days)
  if (a.kind === 'archive_done' && a.columnId) return t('automations.text.archive_column', { n: a.days, column }, a.days)
  return t(`automations.text.${a.kind}`, { n: a.days }, a.days)
}

/** Second line for automations limited to a column (archive_done and move_card name it already). */
const scopeText = (a: BoardAutomation | NewBoardAutomation) =>
  a.columnId && a.kind !== 'archive_done' && a.kind !== 'move_card' ? t('automations.onlyColumn', { column: columnTitle(a.columnId) }) : null

const kindItems = computed(() => boardAutomationKinds.map(k => ({ label: t(`automations.kinds.${k}`), value: k, icon: icons[k] })))
const priorityItems = computed(() => priorities.map(p => ({ label: t(`priority.${p}`), value: p })))
// Select items cannot have a null or empty value (Reka uses '' to clear), so ALL stands for no column.
const ALL = 'all'
const scopeItems = computed(() => [
  { label: t('automations.allColumns'), value: ALL, color: null as string | null },
  ...props.columns.map(c => ({ label: c.title, value: c.id, color: c.color })),
])
const targetItems = computed(() => props.columns.filter(c => c.id !== draft.columnId).map(c => ({ label: c.title, value: c.id, color: c.color })))

const defaults = () => ({
  kind: 'archive_done' as BoardAutomationKind,
  days: 7,
  tagId: undefined as string | undefined,
  priority: 'high' as Priority,
  columnId: (props.columnId ?? ALL) as string | undefined,
  targetColumnId: undefined as string | undefined,
})
const draft = reactive(defaults())
watch(open, (isOpen) => {
  if (isOpen) Object.assign(draft, defaults())
})
// move_card needs a column; the target cannot be the same one.
watch(() => draft.columnId, (c) => {
  if (draft.targetColumnId === c) draft.targetColumnId = undefined
})
watch(() => draft.kind, (k) => {
  if (k === 'move_card' && draft.columnId === ALL) draft.columnId = undefined
  else if (k !== 'move_card' && !draft.columnId) draft.columnId = ALL
})
const scopedColumn = computed(() => draft.columnId && draft.columnId !== ALL ? draft.columnId : null)

const minDays = computed(() => draft.kind === 'raise_priority' ? 0 : 1)
const valid = computed(() => draft.days >= minDays.value && draft.days <= 365
  && (draft.kind !== 'tag_stale' || !!draft.tagId)
  && (draft.kind !== 'move_card' || (!!scopedColumn.value && !!draft.targetColumnId && draft.targetColumnId !== scopedColumn.value)))

function newAutomation(): NewBoardAutomation {
  const { kind, days } = draft
  if (kind === 'move_card') return { kind, days, columnId: scopedColumn.value ?? '', targetColumnId: draft.targetColumnId ?? '' }
  const columnId = scopedColumn.value
  if (kind === 'tag_stale') return { kind, days, columnId, tagId: draft.tagId ?? '' }
  if (kind === 'raise_priority') return { kind, days, columnId, priority: draft.priority }
  return { kind, days, columnId }
}

function add() {
  if (valid.value) emit('add', newAutomation())
}
</script>

<template>
  <UModal v-model:open="open" :title="t('automations.title')" :description="t('automations.description')">
    <template #body>
      <div class="space-y-3">
        <p v-if="!props.automations.length" class="text-sm text-muted">
          {{ t('automations.empty') }}
        </p>
        <div v-for="a in props.automations" :key="a.id" class="flex items-start gap-2 text-sm">
          <UIcon :name="icons[a.kind]" class="size-4 text-dimmed shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0" :class="{ 'opacity-60': !a.active }">
            <div class="flex flex-wrap items-center gap-1.5">
              <span>{{ describe(a) }}</span>
              <TagChip v-if="a.kind === 'tag_stale' && tagById.get(a.tagId)" :tag="tagById.get(a.tagId)!" />
            </div>
            <p v-if="scopeText(a)" class="text-xs text-muted">
              {{ scopeText(a) }}
            </p>
            <p class="text-xs text-muted">
              {{ a.lastRunAt ? t('automations.lastRun', { time: formatDateTime(a.lastRunAt, locale) }) : t('automations.neverRun') }}
            </p>
          </div>
          <USwitch
            :model-value="a.active"
            :disabled="!props.canEdit"
            :aria-label="t('automations.active')"
            @update:model-value="v => emit('update', a, { active: v })"
          />
          <UTooltip v-if="props.canEdit" :text="t('automations.delete')">
            <UButton
              icon="i-lucide-trash"
              color="error"
              variant="ghost"
              size="sm"
              :aria-label="t('automations.delete')"
              @click="emit('delete', a)"
            />
          </UTooltip>
        </div>

        <template v-if="props.canEdit">
          <USeparator class="my-4" />
          <form class="space-y-3" @submit.prevent="add">
            <UFormField :label="t('automations.kind')">
              <USelect v-model="draft.kind" :items="kindItems" class="w-full" />
            </UFormField>
            <div class="flex flex-wrap gap-3">
              <UFormField :label="draft.kind === 'move_card' ? t('automations.fromColumn') : t('automations.column')" class="flex-1 min-w-40">
                <USelect
                  v-model="draft.columnId"
                  :items="draft.kind === 'move_card' ? scopeItems.slice(1) : scopeItems"
                  :placeholder="t('automations.chooseColumn')"
                  class="w-full"
                >
                  <template #item-leading="{ item }">
                    <span v-if="item.value !== ALL" class="size-3 rounded-full shrink-0 bg-elevated" :style="item.color ? { backgroundColor: item.color } : undefined" />
                  </template>
                </USelect>
              </UFormField>
              <UFormField v-if="draft.kind === 'move_card'" :label="t('automations.targetColumn')" class="flex-1 min-w-40">
                <USelect v-model="draft.targetColumnId" :items="targetItems" :placeholder="t('automations.chooseColumn')" class="w-full">
                  <template #item-leading="{ item }">
                    <span class="size-3 rounded-full shrink-0 bg-elevated" :style="item.color ? { backgroundColor: item.color } : undefined" />
                  </template>
                </USelect>
              </UFormField>
            </div>
            <div class="flex flex-wrap gap-3">
              <UFormField :label="t('automations.days')" class="w-32">
                <UInputNumber v-model="draft.days" :min="minDays" :max="365" />
              </UFormField>
              <UFormField v-if="draft.kind === 'tag_stale'" :label="t('automations.tag')" class="flex-1 min-w-48">
                <USelectMenu
                  v-model="draft.tagId"
                  :items="props.tags"
                  value-key="id"
                  label-key="name"
                  :placeholder="t('automations.chooseTag')"
                  class="w-full"
                >
                  <template #item-leading="{ item }">
                    <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
                  </template>
                  <template #empty>
                    {{ t('automations.noTags') }}
                  </template>
                </USelectMenu>
              </UFormField>
              <UFormField v-if="draft.kind === 'raise_priority'" :label="t('automations.priority')" class="flex-1 min-w-40">
                <USelect v-model="draft.priority" :items="priorityItems" class="w-full" />
              </UFormField>
            </div>
            <p class="text-sm text-muted">
              {{ describe(newAutomation()) }}
              <template v-if="scopeText(newAutomation())">
                · {{ scopeText(newAutomation()) }}
              </template>
            </p>
            <UButton type="submit" icon="i-lucide-plus" :label="t('common.add')" :disabled="!valid" />
          </form>
        </template>
        <p v-else class="text-xs text-muted">
          {{ t('automations.readOnly') }}
        </p>
      </div>
    </template>
  </UModal>
</template>
