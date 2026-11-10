<script setup lang="ts">
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { BoardField, Card, Column, Member, Tag } from '#shared/types/board'

const props = defineProps<{
  groupBy: Exclude<GroupBy, 'none'>
  columns: Column[]
  /** Width in px per column id (the board view's resized widths). */
  columnWidth: (columnId: string) => number
  /** Full per-column card lists (useBoard's lists). */
  lists: Record<string, Card[]>
  tags: Tag[]
  fields: BoardField[]
  members: Member[]
  visibleIds: Set<string>
  blockedIds: Set<string>
  canEdit: boolean
  dragDisabled: boolean
  today: string
}>()
const emit = defineEmits<{
  'open': [cardId: string]
  'delete': [card: Card]
  /** Move to `index` of the column's full list; `laneKey` when dropped into another lane (the card takes its value). */
  'move': [card: Card, columnId: string, index: number, laneKey?: string]
  'dragging': [value: boolean]
}>()

const { t } = useI18n()
const ctx = computed(() => ({ members: props.members, tags: props.tags, fields: props.fields }))
const allCards = computed(() => Object.values(props.lists).flat())
const lanes = computed(() => buildLanes(allCards.value, props.groupBy, ctx.value, t))

// One drag list per lane and column, rebuilt from the full lists after every change.
const cells = ref<Record<string, Record<string, Card[]>>>({})
watch([() => props.lists, lanes, () => props.columns], () => {
  cells.value = Object.fromEntries(lanes.value.map(lane => [lane.key, Object.fromEntries(props.columns.map(col => [
    col.id,
    (props.lists[col.id] ?? []).filter(c => laneKeysOf(c, props.groupBy, ctx.value).includes(lane.key)),
  ]))]))
}, { deep: true, immediate: true })

// Multi-valued groupings drag within their lane only (see isMultiValued).
const group = (laneKey: string) => isMultiValued(props.groupBy) ? `lane-${laneKey}` : 'lane-cards'
const laneCount = (laneKey: string) => props.columns.reduce((n, col) =>
  n + (cells.value[laneKey]?.[col.id] ?? []).filter(c => props.visibleIds.has(c.id)).length, 0)

/**
 * After a drop the cell list holds the card at its new index (as a copy).
 * Its neighbours in the lane decide where it goes in the column's full list.
 */
function onDrop(laneKey: string, columnId: string, e: SortableEvent) {
  nextTick(() => {
    const cell = cells.value[laneKey]![columnId]!
    const id = cell[e.newIndex!]!.id
    const card = allCards.value.find(c => c.id === id)
    if (!card) return
    const columnIds = (props.lists[columnId] ?? []).filter(c => c.id !== id).map(c => c.id)
    const index = laneInsertIndex(columnIds, cell[e.newIndex! - 1]?.id ?? null, cell[e.newIndex! + 1]?.id ?? null)
    const changedLane = !laneKeysOf(card, props.groupBy, ctx.value).includes(laneKey)
    emit('move', card, columnId, index, changedLane ? laneKey : undefined)
  })
}
</script>

<template>
  <div class="inline-flex flex-col gap-3 p-4 sm:p-6 min-w-full">
    <div class="flex gap-4 sticky top-0 z-10 ps-0">
      <div
        v-for="col in props.columns"
        :key="col.id"
        class="shrink-0 rounded-lg px-3 py-2 flex items-center gap-2 bg-elevated ring ring-default"
        :style="[{ width: `${props.columnWidth(col.id)}px` }, col.color ? { backgroundColor: col.color, color: contrastText(col.color) } : {}]"
      >
        <h2 class="font-medium truncate flex-1">
          {{ col.title }}
        </h2>
        <UBadge color="neutral" variant="soft" size="sm" :label="String(props.lists[col.id]?.length ?? 0)" />
      </div>
    </div>
    <section v-for="lane in lanes" :key="lane.key" :aria-label="lane.label">
      <h3 class="flex items-center gap-2 mb-2 text-sm font-medium sticky left-4 w-fit">
        <span v-if="lane.color" class="size-3 rounded-full" :style="{ backgroundColor: lane.color }" />
        <UAvatar v-else-if="lane.avatar !== undefined" :src="lane.avatar ?? undefined" :alt="lane.label" size="2xs" />
        {{ lane.label }}
        <span class="text-muted font-normal">· {{ laneCount(lane.key) }}</span>
      </h3>
      <div class="flex gap-4">
        <VueDraggable
          v-for="col in props.columns"
          :key="col.id"
          v-model="cells[lane.key]![col.id]!"
          :group="group(lane.key)"
          :disabled="props.dragDisabled"
          :animation="150"
          ghost-class="opacity-40"
          class="shrink-0 rounded-lg bg-elevated/60 ring ring-default flex flex-col gap-2 p-2 min-h-12"
          :style="{ width: `${props.columnWidth(col.id)}px` }"
          :data-lane="lane.key"
          :data-column="col.id"
          @start="emit('dragging', true)"
          @end="emit('dragging', false)"
          @add="onDrop(lane.key, col.id, $event)"
          @update="onDrop(lane.key, col.id, $event)"
        >
          <BoardCard
            v-for="card in cells[lane.key]![col.id]"
            v-show="props.visibleIds.has(card.id)"
            :key="card.id"
            :card="card"
            :tags="props.tags"
            :fields="props.fields"
            :members="props.members"
            :can-edit="props.canEdit"
            :today="props.today"
            :blocked="props.blockedIds.has(card.id)"
            @open="emit('open', card.id)"
            @delete="emit('delete', card)"
          />
        </VueDraggable>
      </div>
    </section>
  </div>
</template>
