<script setup lang="ts">
import {
  boardAutomationKinds, priorities, scheduledCardActionKinds,
  type BoardAutomation, type BoardAutomationKind, type Card, type Column, type NewBoardAutomation, type NewScheduledCardAction,
  type Priority, type ScheduledCardAction, type ScheduledCardActionKind, type Tag,
} from '#shared/types/board'

const props = defineProps<{
  automations: BoardAutomation[]
  tags: Tag[]
  columns: Column[]
  /** Cards of the board, to name the card of card automations. */
  cards?: Card[]
  canEdit: boolean
  /** Column preselected for a new automation (opened from a column's menu). */
  columnId?: string | null
  /** Card mode: this card's automations, scheduled actions and skip switch. */
  card?: Card | null
  scheduledActions?: ScheduledCardAction[]
}>()
const emit = defineEmits<{
  add: [automation: NewBoardAutomation]
  update: [automation: BoardAutomation, patch: { active: boolean }]
  delete: [automation: BoardAutomation]
  schedule: [action: NewScheduledCardAction]
  unschedule: [action: ScheduledCardAction]
  skip: [skip: boolean]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t, locale } = useI18n()

const cardMode = computed(() => !!props.card)
const tagById = computed(() => new Map(props.tags.map(tag => [tag.id, tag])))

const icons: Record<BoardAutomationKind, string> = {
  archive_done: 'i-lucide-archive',
  tag_stale: 'i-lucide-tag',
  notify_stale: 'i-lucide-bell',
  raise_priority: 'i-lucide-arrow-up-circle',
  move_card: 'i-lucide-arrow-right-left',
}
const actionIcons: Record<ScheduledCardActionKind, string> = {
  move: 'i-lucide-arrow-right-left',
  archive: 'i-lucide-archive',
  priority: 'i-lucide-arrow-up-circle',
  remind: 'i-lucide-bell',
}

const columnTitle = (id: string | null | undefined) => props.columns.find(c => c.id === id)?.title ?? '?'

const shown = computed(() => props.card ? props.automations.filter(a => a.cardId === props.card!.id) : props.automations)

function describe(a: BoardAutomation | NewBoardAutomation) {
  const column = columnTitle(a.columnId)
  const target = a.kind === 'move_card' ? columnTitle(a.targetColumnId) : ''
  const priority = a.kind === 'raise_priority' ? t(`priority.${a.priority}`) : ''
  // One card: its own wording. raise_priority has three forms: due today, within a day, within {n} days.
  if (a.cardId) return t(`automations.cardText.${a.kind}`, { n: a.days, target, priority }, a.days)
  if (a.kind === 'raise_priority') return t('automations.text.raise_priority', { n: a.days, priority }, a.days)
  if (a.kind === 'move_card') return t('automations.text.move_card', { n: a.days, column, target }, a.days)
  if (a.kind === 'archive_done' && a.columnId) return t('automations.text.archive_column', { n: a.days, column }, a.days)
  return t(`automations.text.${a.kind}`, { n: a.days }, a.days)
}

/** Second line for automations limited to a column (archive_done and move_card name it already) or, on the board, a card. */
function scopeText(a: BoardAutomation | NewBoardAutomation) {
  if (a.cardId) {
    if (cardMode.value) return null
    const card = props.cards?.find(c => c.id === a.cardId)
    return card ? t('automations.onlyCard', { card: card.title }) : t('automations.onlyOneCard')
  }
  return a.columnId && a.kind !== 'archive_done' && a.kind !== 'move_card' ? t('automations.onlyColumn', { column: columnTitle(a.columnId) }) : null
}

const kindItems = computed(() => boardAutomationKinds.map(k => ({
  label: t(cardMode.value ? `automations.cardKinds.${k}` : `automations.kinds.${k}`), value: k, icon: icons[k],
})))
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
  columnId: (props.card ? ALL : props.columnId ?? ALL) as string | undefined,
  targetColumnId: undefined as string | undefined,
})
const draft = reactive(defaults())
// move_card needs a column (on the board); the target cannot be the same one.
watch(() => draft.columnId, (c) => {
  if (draft.targetColumnId === c) draft.targetColumnId = undefined
})
watch(() => draft.kind, (k) => {
  if (cardMode.value) return
  if (k === 'move_card' && draft.columnId === ALL) draft.columnId = undefined
  else if (k !== 'move_card' && !draft.columnId) draft.columnId = ALL
})
const scopedColumn = computed(() => !cardMode.value && draft.columnId && draft.columnId !== ALL ? draft.columnId : null)

const minDays = computed(() => draft.kind === 'raise_priority' ? 0 : 1)
const valid = computed(() => draft.days >= minDays.value && draft.days <= 365
  && (draft.kind !== 'tag_stale' || !!draft.tagId)
  && (draft.kind !== 'move_card' || ((cardMode.value || !!scopedColumn.value) && !!draft.targetColumnId && draft.targetColumnId !== scopedColumn.value)))

function newAutomation(): NewBoardAutomation {
  const { kind, days } = draft
  const scope = { columnId: scopedColumn.value, cardId: props.card?.id ?? null }
  if (kind === 'move_card') return { kind, days, ...scope, targetColumnId: draft.targetColumnId ?? '' }
  if (kind === 'tag_stale') return { kind, days, ...scope, tagId: draft.tagId ?? '' }
  if (kind === 'raise_priority') return { kind, days, ...scope, priority: draft.priority }
  return { kind, days, ...scope }
}

function add() {
  if (valid.value) emit('add', newAutomation())
}

// ---------------------------------------------------------------- scheduled actions (card mode)

const cardActions = computed(() => props.card ? (props.scheduledActions ?? []).filter(s => s.cardId === props.card!.id) : [])

/** YYYY-MM-DD of today + days, in local time. */
function isoDay(days = 0) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const actionKindItems = computed(() => scheduledCardActionKinds.map(k => ({ label: t(`automations.scheduled.kinds.${k}`), value: k, icon: actionIcons[k] })))
const actionTargetItems = computed(() => props.columns.map(c => ({ label: c.title, value: c.id, color: c.color })))
const actionDefaults = () => ({
  kind: 'remind' as ScheduledCardActionKind,
  runOn: isoDay(1),
  targetColumnId: undefined as string | undefined,
  priority: 'high' as Priority,
  note: '',
})
const action = reactive(actionDefaults())

// The page mounts the dialog only while open (so it stacks over an open card); reset on (re)open anyway.
watch(open, (isOpen) => {
  if (isOpen) {
    Object.assign(draft, defaults())
    Object.assign(action, actionDefaults())
  }
})
const actionValid = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(action.runOn) && action.runOn >= isoDay()
  && (action.kind !== 'move' || !!action.targetColumnId)
  && action.note.length <= 500)

function newAction(): NewScheduledCardAction {
  const { kind, runOn } = action
  if (kind === 'move') return { kind, runOn, targetColumnId: action.targetColumnId ?? '' }
  if (kind === 'priority') return { kind, runOn, priority: action.priority }
  if (kind === 'remind') return { kind, runOn, note: action.note.trim() || null }
  return { kind, runOn }
}

function describeAction(s: NewScheduledCardAction) {
  const date = formatDate(s.runOn, locale.value)
  if (s.kind === 'move') return t('automations.scheduled.text.move', { date, column: columnTitle(s.targetColumnId) })
  if (s.kind === 'priority') return t('automations.scheduled.text.priority', { date, priority: t(`priority.${s.priority}`) })
  if (s.kind === 'remind') return t('automations.scheduled.text.remind', { date })
  return t('automations.scheduled.text.archive', { date })
}

function schedule() {
  if (!actionValid.value) return
  emit('schedule', newAction())
  action.note = ''
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="props.card ? t('automations.card.title', { card: props.card.title }) : t('automations.title')"
    :description="props.card ? t('automations.card.description') : t('automations.description')"
  >
    <template #body>
      <div class="space-y-3">
        <template v-if="props.card">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium">
                {{ t('automations.card.skip') }}
              </p>
              <p class="text-xs text-muted">
                {{ t('automations.card.skipHelp') }}
              </p>
            </div>
            <USwitch
              :model-value="!!props.card.skipAutomations"
              :disabled="!props.canEdit"
              :aria-label="t('automations.card.skip')"
              @update:model-value="v => emit('skip', v)"
            />
          </div>

          <USeparator class="my-4" />
          <h3 class="text-sm font-semibold">
            {{ t('automations.scheduled.title') }}
          </h3>
          <p v-if="!cardActions.length" class="text-sm text-muted">
            {{ t('automations.scheduled.empty') }}
          </p>
          <div v-for="s in cardActions" :key="s.id" class="flex items-start gap-2 text-sm">
            <UIcon :name="actionIcons[s.kind]" class="size-4 text-dimmed shrink-0 mt-0.5" />
            <div class="flex-1 min-w-0">
              <p>{{ describeAction(s) }}</p>
              <p v-if="s.kind === 'remind' && s.note" class="text-xs text-muted break-words">
                {{ s.note }}
              </p>
            </div>
            <UTooltip v-if="props.canEdit" :text="t('automations.scheduled.delete')">
              <UButton
                icon="i-lucide-trash"
                color="error"
                variant="ghost"
                size="sm"
                :aria-label="t('automations.scheduled.delete')"
                @click="emit('unschedule', s)"
              />
            </UTooltip>
          </div>
          <form v-if="props.canEdit" class="space-y-3" @submit.prevent="schedule">
            <div class="flex flex-wrap gap-3">
              <UFormField :label="t('automations.scheduled.kind')" class="flex-1 min-w-40">
                <USelect v-model="action.kind" :items="actionKindItems" class="w-full" />
              </UFormField>
              <UFormField :label="t('automations.scheduled.date')" class="w-44">
                <UInput v-model="action.runOn" type="date" :min="isoDay()" class="w-full" />
              </UFormField>
            </div>
            <UFormField v-if="action.kind === 'move'" :label="t('automations.targetColumn')">
              <USelect v-model="action.targetColumnId" :items="actionTargetItems" :placeholder="t('automations.chooseColumn')" class="w-full">
                <template #item-leading="{ item }">
                  <span class="size-3 rounded-full shrink-0 bg-elevated" :style="item.color ? { backgroundColor: item.color } : undefined" />
                </template>
              </USelect>
            </UFormField>
            <UFormField v-if="action.kind === 'priority'" :label="t('automations.priority')">
              <USelect v-model="action.priority" :items="priorityItems" class="w-full" />
            </UFormField>
            <UFormField v-if="action.kind === 'remind'" :label="t('automations.scheduled.note')">
              <UInput v-model="action.note" :maxlength="500" :placeholder="t('automations.scheduled.notePlaceholder')" class="w-full" />
            </UFormField>
            <UButton type="submit" icon="i-lucide-calendar-plus" :label="t('automations.scheduled.add')" :disabled="!actionValid" />
          </form>

          <USeparator class="my-4" />
          <h3 class="text-sm font-semibold">
            {{ t('automations.card.recurring') }}
          </h3>
        </template>

        <p v-if="!shown.length" class="text-sm text-muted">
          {{ t('automations.empty') }}
        </p>
        <div v-for="a in shown" :key="a.id" class="flex items-start gap-2 text-sm">
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
          <USeparator v-if="!props.card" class="my-4" />
          <form class="space-y-3" @submit.prevent="add">
            <UFormField :label="t('automations.kind')">
              <USelect v-model="draft.kind" :items="kindItems" class="w-full" />
            </UFormField>
            <div v-if="!props.card || draft.kind === 'move_card'" class="flex flex-wrap gap-3">
              <UFormField v-if="!props.card" :label="draft.kind === 'move_card' ? t('automations.fromColumn') : t('automations.column')" class="flex-1 min-w-40">
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
