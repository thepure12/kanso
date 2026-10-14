<script setup lang="ts">
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { BulkCardAction, Card, Column } from '#shared/types/board'

const route = useRoute()
const id = route.params.id as string
const {
  board, error, refresh, columns, lists, tags, fields, templates, recurrences, archived, offline, canEdit, isOwner, dragging, remoteVersion,
  renameBoard, setArchived, deleteBoard, addColumn, renameColumn, setColumnColor, setColumnWipLimit, deleteColumn, columnMoved,
  addColumnRule, deleteColumnRule, addCard, updateCard, setCardCounts, cardLinkChanged, archiveCard, restoreCard, deleteCard,
  deleteArchivedCard, cardMoved, moveCard, addTag, updateTag, deleteTag,
  addField, updateField, fieldMoved, deleteField, setFieldValue,
  addCardFromTemplate, saveAsTemplate, deleteTemplate, setRecurrence, deleteRecurrence, bulkUpdate, undo, redo, undoGroup,
} = await useBoard(id)
const { t } = useI18n()
const i18n = useI18nContext()

if (error.value) throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: t('board.notFound'), fatal: true })

useHead({ title: () => board.value?.name ?? t('board.title') })

const toggleStar = useBoardStar()

const membersOpen = ref(false)
const panelMembers = computed(() => (board.value?.members ?? []).map(m => ({
  ...m,
  role: m.boardRole,
  note: m.teamRole ? `${board.value!.team!.name} · ${t(`board.role.${m.teamRole}`)}` : undefined,
})))

// The open card is tracked by id: a board reload replaces the card objects.
const editingCardId = ref<string | null>(null)
const allCards = computed(() => Object.values(lists.value).flat())
const editingCard = computed(() => editingCardId.value
  ? allCards.value.find(c => c.id === editingCardId.value) ?? templates.value.find(c => c.id === editingCardId.value) ?? null
  : null)
const editingTemplate = computed(() => !!editingCard.value && templates.value.includes(editingCard.value))
const cardOpen = computed({ get: () => !!editingCard.value, set: (v) => { if (!v) editingCardId.value = null } })
// Cards with an open blocker; the last column counts as done (see blockedCardIds).
const blockedIds = computed(() => blockedCardIds(allCards.value, columns.value))

// ?card=<id> (links from notifications) opens that card. The query is dropped
// once read, so the same link works again.
const toast = useToast()
/** Opens a linked card from the card dialog. Archived cards are not on the board. */
function openLinkedCard(cardId: string) {
  if (!allCards.value.some(c => c.id === cardId)) {
    toast.add({ title: t('board.cardArchived'), color: 'warning' })
    return
  }
  editingCardId.value = cardId
}

function openCardFromQuery() {
  const card = route.query.card
  if (typeof card !== 'string') return
  editingCardId.value = card
  if (!editingCard.value) toast.add({ title: t('board.cardMissing'), color: 'warning' })
  const { card: _, ...query } = route.query
  navigateTo({ query }, { replace: true })
}
onMounted(openCardFromQuery)
watch(() => route.query.card, openCardFromQuery)

const confirmDelete = ref(false)
const deletingCard = ref<Card | null>(null)
const deleteCardOpen = computed({ get: () => !!deletingCard.value, set: (v) => { if (!v) deletingCard.value = null } })
function confirmDeleteCard() {
  deleteCard(deletingCard.value!)
  deletingCard.value = null
}
const tagsOpen = ref(false)
const fieldsOpen = ref(false)
const archiveOpen = ref(false)
const activityOpen = ref(false)
const copyOpen = ref(false)
const templatesOpen = ref(false)
const webhooksOpen = ref(false)

function openTemplate(template: Card) {
  templatesOpen.value = false
  editingCardId.value = template.id
}

/** "From template" menu of a column: adds a copy of the template at the end of it. */
function templateMenu(col: Column) {
  return [templates.value.map(tpl => ({ label: tpl.title, icon: 'i-lucide-file-text', onSelect: () => addCardFromTemplate(col.id, tpl) }))]
}

const colouringColumn = ref<Column | null>(null)
const colourOpen = computed({ get: () => !!colouringColumn.value, set: (v) => { if (!v) colouringColumn.value = null } })

const rulesColumn = ref<Column | null>(null)
const rulesOpen = computed({ get: () => !!rulesColumn.value, set: (v) => { if (!v) rulesColumn.value = null } })

// Filters. Drag and drop is off while filtering: hidden cards would make the neighbours wrong.
const filter = ref(emptyFilter())
// Forget filters on fields that were deleted or can no longer be filtered on.
watch(fields, (list) => {
  for (const fieldId of Object.keys(filter.value.fields)) {
    if (!list.some(f => f.id === fieldId && isFilterableField(f))) delete filter.value.fields[fieldId]
  }
}, { deep: true })
const filtering = computed(() => isFilterActive(filter.value))
const today = ref(isoDate())
let dayTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => { dayTimer = setInterval(() => { today.value = isoDate() }, 60_000) })
onBeforeUnmount(() => clearInterval(dayTimer))
const visibleIds = computed(() => new Set(allCards.value.filter(c => matchesFilter(c, filter.value, today.value)).map(c => c.id)))
const dragDisabled = computed(() => !canEdit.value || filtering.value)
/** Shown cards in board order, for the list, calendar and timeline views. */
const visibleCards = computed(() => columns.value.flatMap(col => (lists.value[col.id] ?? []).filter(c => visibleIds.value.has(c.id))))

// View (?view=, board when absent) and swimlane grouping. The last choice per
// board is remembered in localStorage and restored when the URL names no view.
type BoardView = 'board' | 'list' | 'calendar' | 'timeline'
const views: BoardView[] = ['board', 'list', 'calendar', 'timeline']
const viewIcons: Record<BoardView, string> = { board: 'i-lucide-square-kanban', list: 'i-lucide-list', calendar: 'i-lucide-calendar-days', timeline: 'i-lucide-gantt-chart' }
const viewItems = computed(() => views.map(v => ({ label: t(`board.views.${v}`), value: v, icon: viewIcons[v] })))
const isView = (v: unknown): v is BoardView => views.includes(v as BoardView)
const viewKey = `kanban:view:${id}`
const groupKey = `kanban:group-by:${id}`
const view = computed<BoardView>({
  get: () => isView(route.query.view) ? route.query.view : 'board',
  set: (v) => {
    localStorage.setItem(viewKey, v)
    navigateTo({ query: { ...route.query, view: v === 'board' ? undefined : v } }, { replace: true })
  },
})
const groupBy = ref<GroupBy>('none')
watch(groupBy, v => localStorage.setItem(groupKey, v))
onMounted(() => {
  const stored = localStorage.getItem(viewKey)
  if (route.query.view === undefined && isView(stored) && stored !== 'board') view.value = stored
  const group = localStorage.getItem(groupKey)
  if (group && isValidGroupBy(group, fields.value)) groupBy.value = group
})
// A deleted select field ends grouping by it.
watch(fields, (list) => {
  if (!isValidGroupBy(groupBy.value, list)) groupBy.value = 'none'
}, { deep: true })

// Cards picked for a bulk action (board view without swimlanes, list view).
// Only shown cards stay selected, so an action never touches hidden ones.
const selected = ref(new Set<string>())
const selecting = computed(() => selected.value.size > 0)
function select(cardIds: string[], value: boolean) {
  const next = new Set(selected.value)
  for (const cardId of cardIds) {
    if (value) next.add(cardId)
    else next.delete(cardId)
  }
  selected.value = next
}
const toggleSelected = (cardId: string) => select([cardId], !selected.value.has(cardId))
const clearSelection = () => { selected.value = new Set() }
watch([visibleIds, canEdit], () => {
  if (!canEdit.value) return clearSelection()
  if ([...selected.value].some(cardId => !visibleIds.value.has(cardId))) {
    selected.value = new Set([...selected.value].filter(cardId => visibleIds.value.has(cardId)))
  }
})
watch([view, groupBy], clearSelection)
async function applyBulk(action: BulkCardAction) {
  const cardIds = [...selected.value]
  await bulkUpdate(cardIds, action)
  if (action.archived) clearSelection()
}

/**
 * A card dragged into another swimlane takes that lane's value. Only priority
 * and select lanes allow it (assignee and tag lanes drag within the lane).
 * The move and the new value undo as one step.
 */
function moveToLane(card: Card, columnId: string, index: number, laneKey?: string) {
  if (laneKey === undefined) return moveCard(card, columnId, index)
  const field = fields.value.find(f => groupBy.value === `field:${f.id}`)
  return undoGroup(t('board.undo.movedCard'), () => Promise.all([
    moveCard(card, columnId, index),
    groupBy.value === 'priority' ? updateCard(card, { priority: lanePriority(laneKey) }) : undefined,
    field ? setFieldValue(card, field, laneKey === 'none' ? null : laneKey) : undefined,
  ]))
}

// Board shortcuts (listed in app/utils/shortcuts.ts). defineShortcuts skips them
// while typing; they also skip while a dialog is open.
const filters = useTemplateRef<{ focus: () => void }>('filters')
const cardAdds: Record<string, { open: () => void } | null> = {}
defineShortcuts({
  '/': () => { if (!dialogOpen()) filters.value?.focus() },
  'n': () => {
    const first = columns.value[0]
    if (canEdit.value && first && !dialogOpen()) cardAdds[first.id]?.open()
  },
  // Not while typing, so text fields keep their own undo; works in dialogs too.
  'meta_z': () => { undo() },
  'meta_shift_z': () => { redo() },
  'escape': () => { if (selecting.value && !dialogOpen()) clearSelection() },
})

function wipState(col: Column) {
  const count = lists.value[col.id]?.length ?? 0
  if (!col.wipLimit) return null
  return count > col.wipLimit ? 'over' : count === col.wipLimit ? 'full' : 'ok'
}

/** Sum of the estimates of the column's visible cards, or null when none has one. */
function columnPoints(col: Column) {
  const estimates = (lists.value[col.id] ?? []).filter(c => visibleIds.value.has(c.id) && c.estimate !== null).map(c => c.estimate!)
  return estimates.length ? Number(estimates.reduce((a, b) => a + b, 0).toFixed(2)) : null
}

// Draggable handlers run after vue-draggable-plus has updated the bound arrays.
function onCardDrop(columnId: string, e: SortableEvent) {
  nextTick(() => cardMoved(columnId, e.newIndex!))
}
function onColumnDrop(e: SortableEvent) {
  nextTick(() => columnMoved(e.newIndex!))
}

function columnMenu(col: Column) {
  return [[
    { label: t('board.column.rename'), icon: 'i-lucide-pencil', onSelect: () => {
      const title = prompt(t('board.column.titlePrompt'), col.title)?.trim()
      if (title) renameColumn(col, title)
    } },
    { label: t('board.column.colour'), icon: 'i-lucide-palette', onSelect: () => { colouringColumn.value = col } },
    { label: t('board.column.wipLimit'), icon: 'i-lucide-gauge', onSelect: () => {
      const input = prompt(t('board.column.wipPrompt'), col.wipLimit?.toString() ?? '')
      if (input === null) return
      const value = input.trim() ? Number(input) : null
      if (value !== null && !(Number.isInteger(value) && value >= 1 && value <= 999)) return alert(t('board.column.wipInvalid'))
      setColumnWipLimit(col, value)
    } },
    { label: t('board.column.rules'), icon: 'i-lucide-zap', onSelect: () => { rulesColumn.value = col } },
    { label: t('common.delete'), icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => {
      if (confirm(t('board.column.deleteConfirm', { title: col.title }))) deleteColumn(col)
    } },
  ]]
}

const boardMenu = computed(() => [
  [
    ...(canEdit.value ? [{ label: t('board.menu.fields'), icon: 'i-lucide-list-plus', onSelect: () => { fieldsOpen.value = true } }] : []),
    { label: t('board.menu.activity'), icon: 'i-lucide-history', onSelect: () => { activityOpen.value = true } },
    { label: t('board.menu.archived'), icon: 'i-lucide-archive', onSelect: () => { archiveOpen.value = true } },
    { label: t('board.menu.templates'), icon: 'i-lucide-file-stack', onSelect: () => { templatesOpen.value = true } },
    { label: t('board.menu.copy'), icon: 'i-lucide-copy', onSelect: () => { copyOpen.value = true } },
    { label: t('board.menu.exportJson'), icon: 'i-lucide-file-json', to: `/api/boards/${id}/export?format=json`, external: true, download: true },
    { label: t('board.menu.exportCsv'), icon: 'i-lucide-file-spreadsheet', to: `/api/boards/${id}/export?format=csv`, external: true, download: true },
  ],
  ...(isOwner.value
    ? [[
        { label: t('board.menu.webhooks'), icon: 'i-lucide-webhook', onSelect: () => { webhooksOpen.value = true } },
        ...(archived.value
          ? [{ label: t('board.menu.unarchive'), icon: 'i-lucide-archive-restore', onSelect: () => setArchived(false) }]
          : [
              { label: t('board.menu.rename'), icon: 'i-lucide-pencil', onSelect: () => {
                const name = prompt(t('board.menu.namePrompt'), board.value?.name)?.trim()
                if (name) renameBoard(name)
              } },
              { label: t('board.menu.archive'), icon: 'i-lucide-archive', onSelect: () => {
                if (confirm(t('board.menu.archiveConfirm'))) setArchived(true)
              } },
            ]),
        { label: t('board.menu.delete'), icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => { confirmDelete.value = true } },
      ]]
    : []),
])
</script>

<template>
  <div v-if="board" class="flex-1 flex flex-col min-h-0">
    <div class="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-4 border-b border-default">
      <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" :aria-label="t('board.allBoards')" />
      <div class="min-w-0">
        <ULink v-if="board.team" :to="`/teams/${board.team.id}`" class="block text-xs text-muted hover:underline truncate">
          {{ board.team.name }}
        </ULink>
        <h1 class="text-xl font-semibold truncate">
          {{ board.name }}
        </h1>
      </div>
      <UButton
        icon="i-lucide-star"
        color="neutral"
        variant="ghost"
        :class="board.starred ? 'text-warning' : 'text-dimmed'"
        :aria-label="board.starred ? t('board.unstar') : t('board.star')"
        :aria-pressed="board.starred"
        @click="toggleStar(board)"
      />
      <UBadge v-if="archived" color="warning" variant="subtle" icon="i-lucide-archive" :label="t('board.archivedBadge')" />
      <UTooltip v-else-if="offline" :text="t('pwa.readOnlyHint')">
        <UBadge color="warning" variant="subtle" icon="i-lucide-wifi-off" :label="t('pwa.readOnly')" />
      </UTooltip>
      <UBadge v-else-if="!canEdit" color="neutral" variant="subtle" icon="i-lucide-eye" :label="t('board.viewOnly')" />
      <div class="ms-auto flex items-center gap-2">
        <UAvatarGroup :max="4" size="sm">
          <UAvatar v-for="m in board.members" :key="m.userId" :src="m.avatarUrl ?? undefined" :alt="m.name" />
        </UAvatarGroup>
        <UButton v-if="canEdit" icon="i-lucide-tags" color="neutral" variant="outline" :label="t('board.tags')" @click="tagsOpen = true" />
        <UButton icon="i-lucide-users" color="neutral" variant="outline" :label="t('board.members')" @click="membersOpen = true" />
        <UDropdownMenu :items="boardMenu">
          <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" :aria-label="t('board.actions')" />
        </UDropdownMenu>
      </div>
    </div>

    <UAlert
      v-if="archived"
      color="warning"
      variant="subtle"
      icon="i-lucide-archive"
      :title="t('board.archivedTitle')"
      :description="isOwner ? t('board.archivedOwner') : t('board.archivedMember')"
      :actions="isOwner ? [{ label: t('board.unarchive'), icon: 'i-lucide-archive-restore', color: 'warning', variant: 'solid', onClick: () => setArchived(false) }] : []"
      class="mx-4 sm:mx-6 mt-3 w-auto"
    />

    <div class="px-4 sm:px-6 pt-3 flex flex-wrap items-center gap-2">
      <UTabs v-model="view" :items="viewItems" :content="false" size="sm" :aria-label="t('board.viewLabel')" />
      <USelect
        v-if="view === 'board'"
        v-model="groupBy"
        :items="groupByItems(fields, t)"
        icon="i-lucide-rows-3"
        size="sm"
        class="w-40"
        :aria-label="t('board.swimlanes')"
      />
    </div>
    <div class="px-4 sm:px-6 pt-3">
      <BoardFilters ref="filters" v-model="filter" :tags="tags" :fields="fields" :members="board.members" :shown="visibleIds.size" :total="allCards.length" />
    </div>

    <div v-if="view === 'list'" class="flex-1 overflow-auto p-4 sm:p-6">
      <BoardListView
        :cards="visibleCards"
        :columns="columns"
        :members="board.members"
        :tags="tags"
        :fields="fields"
        :can-edit="canEdit"
        :today="today"
        :selected-ids="selected"
        @open="cardId => editingCardId = cardId"
        @move="(card, columnId) => moveCard(card, columnId)"
        @select="select"
      />
    </div>
    <div v-else-if="view === 'calendar'" class="flex-1 overflow-auto p-4 sm:p-6">
      <BoardCalendarView
        :cards="visibleCards"
        :tags="tags"
        :can-edit="canEdit"
        :today="today"
        @open="cardId => editingCardId = cardId"
        @set-date="(card, patch) => updateCard(card, patch)"
        @dragging="v => dragging = v"
      />
    </div>
    <div v-else-if="view === 'timeline'" class="flex-1 min-h-0 overflow-auto p-4 sm:p-6">
      <BoardTimelineView :cards="visibleCards" :columns="columns" :today="today" @open="cardId => editingCardId = cardId" />
    </div>
    <div v-else-if="groupBy !== 'none'" class="flex-1 overflow-auto">
      <BoardSwimlanes
        :group-by="groupBy"
        :columns="columns"
        :lists="lists"
        :tags="tags"
        :fields="fields"
        :members="board.members"
        :visible-ids="visibleIds"
        :blocked-ids="blockedIds"
        :can-edit="canEdit"
        :drag-disabled="dragDisabled"
        :today="today"
        @open="cardId => editingCardId = cardId"
        @delete="card => deletingCard = card"
        @move="moveToLane"
        @dragging="v => dragging = v"
      />
    </div>
    <div v-else class="flex-1 overflow-x-auto">
      <div class="flex items-start gap-4 p-4 sm:p-6 min-h-full">
        <VueDraggable
          v-model="columns"
          :disabled="!canEdit"
          handle=".column-handle"
          :animation="150"
          class="flex items-start gap-4"
          @start="dragging = true"
          @end="dragging = false"
          @update="onColumnDrop"
        >
          <section
            v-for="col in columns"
            :key="col.id"
            class="w-72 shrink-0 rounded-lg bg-elevated/60 ring flex flex-col max-h-[calc(100vh-14rem)]"
            :class="wipState(col) === 'over' ? 'ring-error' : 'ring-default'"
          >
            <header
              class="flex items-center gap-2 px-3 py-2 rounded-t-lg"
              :style="col.color ? { backgroundColor: col.color, color: contrastText(col.color) } : undefined"
            >
              <UIcon v-if="canEdit" name="i-lucide-grip-vertical" class="column-handle cursor-grab" :class="col.color ? 'opacity-60' : 'text-dimmed'" />
              <h2 class="font-medium truncate flex-1">
                {{ col.title }}
              </h2>
              <UTooltip v-if="col.rules.length" :text="t('board.column.ruleCount', { count: col.rules.length }, col.rules.length)">
                <UIcon name="i-lucide-zap" class="size-4 shrink-0" :class="!col.color && 'text-dimmed'" />
              </UTooltip>
              <UTooltip v-if="columnPoints(col) !== null" :text="filtering ? t('board.column.pointsShown', { points: formatPoints(columnPoints(col)!, i18n) }) : formatPoints(columnPoints(col)!, i18n)">
                <UBadge color="neutral" variant="outline" size="sm" icon="i-lucide-sigma" :label="String(columnPoints(col))" :class="col.color && 'text-inherit'" />
              </UTooltip>
              <UTooltip v-if="col.wipLimit" :text="wipState(col) === 'over' ? t('board.column.overWip', { limit: col.wipLimit }) : t('board.column.wip', { limit: col.wipLimit })">
                <UBadge
                  :color="wipState(col) === 'over' ? 'error' : wipState(col) === 'full' ? 'warning' : 'neutral'"
                  :variant="wipState(col) === 'over' ? 'solid' : 'soft'"
                  size="sm"
                  :label="`${lists[col.id]?.length ?? 0}/${col.wipLimit}`"
                />
              </UTooltip>
              <UBadge v-else color="neutral" variant="soft" size="sm" :label="String(lists[col.id]?.length ?? 0)" />
              <UDropdownMenu v-if="canEdit" :items="columnMenu(col)">
                <UButton icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" :aria-label="t('board.column.actions')" :class="col.color && 'text-inherit hover:bg-black/10'" />
              </UDropdownMenu>
            </header>

            <VueDraggable
              v-model="lists[col.id]!"
              group="cards"
              :disabled="dragDisabled"
              :animation="150"
              ghost-class="opacity-40"
              class="flex flex-col gap-2 px-3 py-2 min-h-8 overflow-y-auto"
              @start="dragging = true"
              @end="dragging = false"
              @add="onCardDrop(col.id, $event)"
              @update="onCardDrop(col.id, $event)"
            >
              <BoardCard
                v-for="card in lists[col.id]"
                v-show="visibleIds.has(card.id)"
                :key="card.id"
                :card="card"
                :tags="tags"
                :fields="fields"
                :members="board.members"
                :can-edit="canEdit"
                :today="today"
                :blocked="blockedIds.has(card.id)"
                :selected="selected.has(card.id)"
                :selecting="selecting"
                @open="editingCardId = card.id"
                @delete="deletingCard = card"
                @select="toggleSelected(card.id)"
              />
            </VueDraggable>

            <div v-if="canEdit" class="px-3 pb-3 flex items-start gap-1">
              <InlineAdd :ref="el => { cardAdds[col.id] = el as { open: () => void } | null }" :label="t('board.addCard')" :placeholder="t('board.cardTitle')" class="flex-1 min-w-0" @add="title => addCard(col.id, title)" />
              <UDropdownMenu v-if="templates.length" :items="templateMenu(col)" :content="{ align: 'end' }">
                <UTooltip :text="t('board.fromTemplate')">
                  <UButton color="neutral" variant="ghost" icon="i-lucide-file-plus" :aria-label="t('board.addFromTemplate')" />
                </UTooltip>
              </UDropdownMenu>
            </div>
          </section>
        </VueDraggable>

        <div v-if="canEdit" class="w-72 shrink-0">
          <InlineAdd :label="t('board.addColumn')" :placeholder="t('board.columnTitle')" @add="addColumn" />
        </div>
      </div>
    </div>

    <BulkActionsBar
      v-if="selecting"
      :count="selected.size"
      :columns="columns"
      :tags="tags"
      :members="board.members"
      @apply="applyBulk"
      @clear="clearSelection"
    />
    <CardModal
      v-if="editingCard"
      v-model:open="cardOpen"
      :card="editingCard"
      :members="board.members"
      :tags="tags"
      :fields="fields"
      :cards="allCards"
      :columns="columns"
      :can-edit="canEdit"
      :is-owner="isOwner && !archived"
      :create-tag="addTag"
      :remote-version="remoteVersion"
      :template="editingTemplate"
      :recurrence="editingTemplate ? recurrences.find(r => r.templateId === editingCard!.id) ?? null : null"
      @update-tag="updateTag"
      @save="patch => updateCard(editingCard!, patch)"
      @counts="counts => setCardCounts(editingCard!, counts)"
      @archive="archiveCard(editingCard!)"
      @delete="editingTemplate ? deleteTemplate(editingCard!) : deletingCard = editingCard"
      @save-template="withAssignees => saveAsTemplate(editingCard!, withAssignees)"
      @set-recurrence="input => setRecurrence(editingCard!, input)"
      @delete-recurrence="deleteRecurrence(editingCard!)"
      @open-card="openLinkedCard"
      @link="(link, added) => cardLinkChanged(editingCard!, link, added)"
      @set-field="(field, value) => setFieldValue(editingCard!, field, value)"
    />
    <ColumnColorModal
      v-if="colouringColumn"
      v-model:open="colourOpen"
      :title="colouringColumn.title"
      :color="colouringColumn.color"
      @save="color => setColumnColor(colouringColumn!, color)"
    />
    <ColumnRulesModal
      v-if="rulesColumn"
      v-model:open="rulesOpen"
      :column="rulesColumn"
      :tags="tags"
      :members="board?.members ?? []"
      @add="rule => addColumnRule(rulesColumn!, rule)"
      @delete="rule => deleteColumnRule(rulesColumn!, rule)"
    />
    <TagsModal
      v-model:open="tagsOpen"
      :tags="tags"
      @create="addTag"
      @update="updateTag"
      @delete="deleteTag"
    />
    <BoardFieldsModal
      v-model:open="fieldsOpen"
      v-model:fields="fields"
      @create="addField"
      @update="updateField"
      @move="fieldMoved"
      @delete="deleteField"
    />
    <ArchiveSlideover
      v-model:open="archiveOpen"
      :board-id="board.id"
      :columns="columns"
      :can-edit="canEdit"
      :version="remoteVersion"
      :restore="restoreCard"
      :remove="deleteArchivedCard"
    />
    <TemplatesSlideover
      v-model:open="templatesOpen"
      :templates="templates"
      :recurrences="recurrences"
      :columns="columns"
      :can-edit="canEdit"
      @open="openTemplate"
      @delete="deleteTemplate"
    />
    <BoardActivitySlideover v-model:open="activityOpen" :board-id="board.id" :version="remoteVersion" />
    <WebhooksSlideover v-if="isOwner" v-model:open="webhooksOpen" :board-id="board.id" />
    <CopyBoardModal v-model:open="copyOpen" :board-id="board.id" :board-name="board.name" :team-id="board.team?.id ?? null" />
    <MembersSlideover
      v-model:open="membersOpen"
      :title="t('board.membersTitle')"
      :description="board.team ? t('board.membersTeam', { team: board.team.name }) : t('board.membersPersonal')"
      :endpoint="`/api/boards/${board.id}/members`"
      :members="panelMembers"
      :invites="board.invites"
      :invites-endpoint="`/api/boards/${board.id}/invites`"
      :can-manage="isOwner"
      @changed="refresh"
      @left="navigateTo('/')"
    />

    <UModal v-model:open="confirmDelete" :title="t('board.deleteTitle')" :description="t('board.deleteDescription')">
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="confirmDelete = false" />
          <UButton color="error" :label="t('board.menu.delete')" @click="deleteBoard" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="deleteCardOpen" :title="t('board.deleteCardTitle', { title: deletingCard?.title })" :description="t('board.deleteCardDescription')">
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="deletingCard = null" />
          <UButton color="neutral" variant="outline" icon="i-lucide-archive" :label="t('board.archiveInstead')" @click="archiveCard(deletingCard!); deletingCard = null" />
          <UButton color="error" :label="t('board.deleteCard')" @click="confirmDeleteCard" />
        </div>
      </template>
    </UModal>
  </div>
</template>
