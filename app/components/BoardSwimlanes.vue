<script setup lang="ts">
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { BoardField, Card, Column, Member, Tag } from '#shared/types/board'
import { type ColumnOutline, columnOutlineStyle, effectiveColumnOutline } from '#shared/columnOutline'

const props = defineProps<{
  groupBy: Exclude<GroupBy, 'none'>
  columns: Column[]
  /** Width in px per column id (the board view's resized widths). */
  columnWidth: (columnId: string) => number
  /** Whether a column is collapsed to a narrow strip (personal, shared with the board view). */
  collapsed?: (columnId: string) => boolean
  /** The board's column frame setting; null = default ring. */
  outline?: ColumnOutline | null
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
  'rename': [card: Card, title: string]
  'collapse': [columnId: string, value: boolean]
}>()

const { t } = useI18n()
const isCollapsed = (columnId: string) => props.collapsed?.(columnId) ?? false
const widthStyle = (columnId: string) => isCollapsed(columnId)
  ? { width: `${COLLAPSED_COLUMN_WIDTH}px` }
  : { width: `${props.columnWidth(columnId)}px`, maxWidth: 'calc(100vw - 3rem)' }
const cellCount = (laneKey: string, columnId: string) =>
  (cells.value[laneKey]?.[columnId] ?? []).filter(c => props.visibleIds.has(c.id)).length
/** Frame style per column (own outline, else the board's); null = default ring classes. */
const frames = computed(() => Object.fromEntries(props.columns.map(col =>
  [col.id, columnOutlineStyle(effectiveColumnOutline(col, props.outline), false, col.color)])))
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

/**
 * Drop on a collapsed cell: its list stays empty (the source cell drops the
 * card itself) and the card goes to the end of the column, taking the lane.
 */
const collapsedDropSink: Card[] = []
function onCollapsedDrop(laneKey: string, columnId: string, e: SortableEvent) {
  const id = (e.item as HTMLElement).dataset.cardId
  nextTick(() => {
    collapsedDropSink.length = 0
    const card = allCards.value.find(c => c.id === id)
    if (!card) return
    const index = (props.lists[columnId] ?? []).filter(c => c.id !== id).length
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
        class="group/col shrink-0 rounded-lg flex items-center gap-2 bg-elevated"
        :class="[!frames[col.id] && 'ring ring-default', isCollapsed(col.id) ? 'justify-center' : 'px-3 py-2']"
        :style="[widthStyle(col.id), col.color ? { backgroundColor: col.color, color: contrastText(col.color) } : {}, frames[col.id] ?? {}]"
      >
        <UTooltip v-if="isCollapsed(col.id)" :text="t('board.column.expand', { title: col.title, count: props.lists[col.id]?.length ?? 0 })">
          <button
            type="button"
            class="flex-1 flex justify-center py-2 rounded-lg cursor-pointer hover:bg-accented/40 focus-visible:outline-2 focus-visible:outline-primary"
            :aria-label="t('board.column.expand', { title: col.title, count: props.lists[col.id]?.length ?? 0 })"
            @click="emit('collapse', col.id, false)"
          >
            <UBadge color="neutral" variant="soft" size="sm" :label="String(props.lists[col.id]?.length ?? 0)" />
          </button>
        </UTooltip>
        <template v-else>
          <h2 class="font-medium truncate flex-1">
            {{ col.title }}
          </h2>
          <UBadge color="neutral" variant="soft" size="sm" :label="String(props.lists[col.id]?.length ?? 0)" />
          <UTooltip :text="t('board.column.collapse')">
            <UButton
              icon="i-lucide-fold-horizontal"
              size="xs"
              color="neutral"
              variant="ghost"
              class="pointer-coarse:p-1.5 pointer-fine:opacity-0 pointer-fine:group-hover/col:opacity-100 focus-visible:opacity-100"
              :class="col.color && 'text-inherit hover:bg-black/10'"
              :aria-label="t('board.column.collapse')"
              @click="emit('collapse', col.id, true)"
            />
          </UTooltip>
        </template>
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
        <template v-for="col in props.columns" :key="col.id">
          <!-- Collapsed cell: click expands; a card dropped on it goes to the end of the column. -->
          <VueDraggable
            v-if="isCollapsed(col.id)"
            :model-value="collapsedDropSink"
            :group="group(lane.key)"
            :disabled="props.dragDisabled"
            draggable="[data-card-id]"
            class="shrink-0 flex flex-col rounded-lg has-[[data-card-id]]:ring-2 has-[[data-card-id]]:ring-primary [&>[data-card-id]]:hidden"
            :style="widthStyle(col.id)"
            :data-lane="lane.key"
            :data-collapsed-column="col.id"
            @add="onCollapsedDrop(lane.key, col.id, $event)"
          >
            <button
              type="button"
              class="flex-1 rounded-lg bg-elevated/60 flex justify-center p-2 min-h-12 text-xs text-muted cursor-pointer hover:bg-accented/40"
              :class="!frames[col.id] && 'ring ring-default'"
              :style="frames[col.id] ?? {}"
              :aria-label="t('board.column.expand', { title: col.title, count: cellCount(lane.key, col.id) })"
              :title="t('board.column.expand', { title: col.title, count: cellCount(lane.key, col.id) })"
              @click="emit('collapse', col.id, false)"
            >
              {{ cellCount(lane.key, col.id) || '' }}
            </button>
          </VueDraggable>
          <VueDraggable
            v-else
            v-model="cells[lane.key]![col.id]!"
            :group="group(lane.key)"
            :disabled="props.dragDisabled"
            :animation="150"
            :delay="200"
            :delay-on-touch-only="true"
            :touch-start-threshold="5"
            :force-auto-scroll-fallback="true"
            :scroll-sensitivity="80"
            :scroll-speed="16"
            filter=".card-title-edit"
            :prevent-on-filter="false"
            ghost-class="opacity-40"
            class="shrink-0 rounded-lg bg-elevated/60 flex flex-col gap-2 p-2 min-h-12"
            :class="!frames[col.id] && 'ring ring-default'"
            :style="[widthStyle(col.id), frames[col.id] ?? {}]"
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
              :data-card-id="card.id"
              :card="card"
              :tags="props.tags"
              :fields="props.fields"
              :members="props.members"
              :can-edit="props.canEdit"
              :today="props.today"
              :blocked="props.blockedIds.has(card.id)"
              @open="emit('open', card.id)"
              @delete="emit('delete', card)"
              @rename="title => emit('rename', card, title)"
            />
          </VueDraggable>
        </template>
      </div>
    </section>
  </div>
</template>
