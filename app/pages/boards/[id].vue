<script setup lang="ts">
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { BulkCardAction, Card, Column } from '#shared/types/board'
import { backgroundStyle } from '#shared/boardBackgrounds'
import { CARD_TITLE_MAX } from '#shared/cards'

const route = useRoute()
const id = route.params.id as string
const {
  board, error, refresh, columns, columnGroups, lists, tags, fields, templates, recurrences, automations, archived, offline, canEdit, isOwner, dragging, remoteVersion,
  renameBoard, setArchived, setBackground, setAccent, uploadBackground, deleteBoard, addColumn, renameColumn, setColumnColor, setColumnWipLimit, sortColumnByPriority, deleteColumn, columnMoved,
  addColumnRule, deleteColumnRule, addAutomation, updateAutomation, deleteAutomation, addCard, updateCard, setCardCounts, cardLinkChanged, archiveCard, restoreCard, deleteCard, restoreTrashedCard,
  deleteArchivedCard, cardMoved, moveCard, addTag, updateTag, deleteTag,
  addField, updateField, fieldMoved, deleteField, setFieldValue,
  addColumnGroup, updateColumnGroup, columnGroupMoved, deleteColumnGroup,
  addCardFromTemplate, saveAsTemplate, deleteTemplate, setRecurrence, deleteRecurrence, bulkUpdate, undo, redo, undoGroup,
} = await useBoard(id)
const { t } = useI18n()
const confirm = useConfirm()
const ask = usePrompt()
const i18n = useI18nContext()

if (error.value) throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: t('board.notFound'), fatal: true })

useHead({ title: () => board.value?.name ?? t('board.title') })

const toggleStar = useBoardStar()

const backgroundOpen = ref(false)
const base = basePath()
const bgStyle = computed(() => backgroundStyle(board.value?.background, id, false, base))
// Over a background, bars and panels get an opaque-ish backing to stay readable.
const backed = computed(() => !!bgStyle.value)
const panel = computed(() => backed.value ? 'bg-default/95 rounded-lg p-2 sm:p-3' : undefined)

useBoardAccent(() => board.value?.accent)

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

// ?card=<id> opens that card, and the open card is kept in ?card= (replacing the
// history entry), so the address bar is a direct link to it. Closing drops it.
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
  if (card === editingCardId.value) return
  editingCardId.value = card
  if (editingCard.value) return
  editingCardId.value = null
  toast.add({ title: t('board.cardMissing'), color: 'warning' })
  setCardQuery(null)
}
function setCardQuery(cardId: string | null) {
  if ((route.query.card ?? null) === cardId) return
  navigateTo({ query: { ...route.query, card: cardId ?? undefined } }, { replace: true })
}
onMounted(() => {
  openCardFromQuery()
  // Also drops ?card= when the open card disappears (archived or deleted elsewhere).
  watch(() => editingCard.value?.id ?? null, setCardQuery)
})
watch(() => route.query.card, openCardFromQuery)
/** The open card's direct link, for the dialog's "Copy link". */
const cardLink = computed(() => editingCard.value && import.meta.client
  ? `${window.location.origin}${base}/boards/${id}?card=${editingCard.value.id}`
  : undefined)

const confirmDelete = ref(false)
const tagsOpen = ref(false)
const fieldsOpen = ref(false)
const archiveOpen = ref(false)
const trashOpen = ref(false)
const activityOpen = ref(false)
const copyOpen = ref(false)
const templatesOpen = ref(false)
const webhooksOpen = ref(false)
const automationsOpen = ref(false)

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
// Column group shown in the board view (null = all columns), remembered per board.
// Other views always show every column (see docs/ROADMAP.md).
const columnGroupKey = `kanban:column-group:${id}`
const columnGroupId = ref<string | null>(null)
const shownGroup = computed(() => columnGroups.value.find(g => g.id === columnGroupId.value) ?? null)
const shownColumns = computed(() => columnsInGroup(columns.value, shownGroup.value))
const shownColumnIds = computed(() => new Set(shownColumns.value.map(c => c.id)))
const columnGroupItems = computed(() => [
  { label: t('columnGroups.all'), value: 'all' },
  ...columnGroups.value.map(g => ({ label: g.name, value: g.id, chip: g.color ? { color: 'neutral' as const, style: { backgroundColor: g.color } } : undefined })),
])
const columnGroupModel = computed({
  get: () => shownGroup.value?.id ?? 'all',
  set: (v: string) => { showColumnGroup(v === 'all' ? null : v) },
})
function showColumnGroup(groupId: string | null) {
  columnGroupId.value = groupId
  try {
    if (groupId) localStorage.setItem(columnGroupKey, groupId)
    else localStorage.removeItem(columnGroupKey)
  }
  catch { /* storage unavailable */ }
}
onMounted(() => {
  try {
    columnGroupId.value = localStorage.getItem(columnGroupKey)
  }
  catch { /* storage unavailable */ }
})
// A deleted group shows all columns again.
watch(columnGroups, (list) => {
  if (columnGroupId.value && !list.some(g => g.id === columnGroupId.value)) showColumnGroup(null)
})
const columnGroupsOpen = ref(false)

// Tag and column group chips: names or colour only (personal, all boards).
const labels = useLabelDisplay()
onMounted(loadLabelDisplay)

// Column widths (drag a column's right edge; personal, per board).
const columnWidths = useColumnWidths(id, computed(() => columns.value.map(c => c.id)))

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
    const first = shownColumns.value[0]
    if (canEdit.value && first && !dialogOpen()) cardAdds[first.id]?.open()
  },
  // Not while typing, so text fields keep their own undo; works in dialogs too.
  'meta_z': () => { undo() },
  'meta_shift_z': () => { redo() },
  'escape': () => { if (selecting.value && !dialogOpen()) clearSelection() },
})

/** Group chips on a column header; none for the group being shown when it is the column's only one. */
function columnChips(col: Column) {
  const groups = groupsForColumn(columnGroups.value, col.id)
  return shownGroup.value && groups.length === 1 ? [] : groups
}

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

// Inline column rename: double-click the title, Enter or blur saves, Escape cancels.
const renamingColumnId = ref<string | null>(null)
const columnTitleDraft = ref('')
function startColumnRename(col: Column) {
  if (!canEdit.value) return
  columnTitleDraft.value = col.title
  renamingColumnId.value = col.id
}
function finishColumnRename(col: Column, save: boolean) {
  if (renamingColumnId.value !== col.id) return
  renamingColumnId.value = null
  const title = columnTitleDraft.value.trim()
  if (save && title && title !== col.title) renameColumn(col, title)
}
function focusRenameInput(el: unknown) {
  if (el instanceof HTMLInputElement && document.activeElement !== el) {
    el.focus()
    el.select()
  }
}

function columnMenu(col: Column) {
  return [[
    { label: t('board.column.rename'), icon: 'i-lucide-pencil', onSelect: async () => {
      const title = (await ask({ title: t('board.column.rename'), label: t('board.column.titlePrompt'), initial: col.title }))?.trim()
      if (title) renameColumn(col, title)
    } },
    { label: t('board.column.colour'), icon: 'i-lucide-palette', onSelect: () => { colouringColumn.value = col } },
    { label: t('board.column.wipLimit'), icon: 'i-lucide-gauge', onSelect: async () => {
      const parse = (input: string) => input.trim() ? Number(input) : null
      const valid = (value: number | null) => value === null || (Number.isInteger(value) && value >= 1 && value <= 999)
      const input = await ask({
        title: t('board.column.wipLimit'),
        description: t('board.column.wipPrompt'),
        initial: col.wipLimit?.toString() ?? '',
        validate: v => valid(parse(v)) ? undefined : t('board.column.wipInvalid'),
      })
      if (input === null) return
      const value = parse(input)
      setColumnWipLimit(col, value)
    } },
    { label: t('board.column.rules'), icon: 'i-lucide-zap', onSelect: () => { rulesColumn.value = col } },
    { label: t('board.column.sortPriority'), icon: 'i-lucide-arrow-down-wide-narrow', disabled: (lists.value[col.id]?.length ?? 0) < 2, onSelect: () => sortColumnByPriority(col) },
    {
      label: t('columnGroups.menu'),
      icon: 'i-lucide-columns-3',
      children: [
        columnGroups.value.map(g => ({
          label: g.name,
          type: 'checkbox' as const,
          checked: g.columnIds.includes(col.id),
          onUpdateChecked: (member: boolean) => updateColumnGroup(g, { columnIds: toggleColumn(g.columnIds, col.id, member) }),
          onSelect: (e: Event) => e.preventDefault(),
        })),
        [{ label: t('columnGroups.manage'), icon: 'i-lucide-settings-2', onSelect: () => { columnGroupsOpen.value = true } }],
      ].filter(items => items.length),
    },
    { label: t('common.delete'), icon: 'i-lucide-trash', color: 'error' as const, onSelect: async () => {
      if (await confirm({ title: t('board.column.deleteConfirm', { title: col.title }), confirmLabel: t('common.delete') })) deleteColumn(col)
    } },
  ]]
}

const boardMenu = computed(() => [
  [
    ...(canEdit.value
      ? [
          { label: t('board.menu.fields'), icon: 'i-lucide-list-plus', onSelect: () => { fieldsOpen.value = true } },
          { label: t('board.menu.columnGroups'), icon: 'i-lucide-columns-3', onSelect: () => { columnGroupsOpen.value = true } },
        ]
      : []),
    { label: t('board.menu.activity'), icon: 'i-lucide-history', onSelect: () => { activityOpen.value = true } },
    { label: t('board.menu.archived'), icon: 'i-lucide-archive', onSelect: () => { archiveOpen.value = true } },
    ...(canEdit.value ? [{ label: t('board.menu.trash'), icon: 'i-lucide-trash-2', onSelect: () => { trashOpen.value = true } }] : []),
    { label: t('board.menu.templates'), icon: 'i-lucide-file-stack', onSelect: () => { templatesOpen.value = true } },
    { label: t('board.menu.automations'), icon: 'i-lucide-timer', onSelect: () => { automationsOpen.value = true } },
    { label: t('board.menu.copy'), icon: 'i-lucide-copy', onSelect: () => { copyOpen.value = true } },
    { label: t('board.menu.exportJson'), icon: 'i-lucide-file-json', to: `${base}/api/boards/${id}/export?format=json`, external: true, download: true },
    { label: t('board.menu.exportCsv'), icon: 'i-lucide-file-spreadsheet', to: `${base}/api/boards/${id}/export?format=csv`, external: true, download: true },
  ],
  ...(isOwner.value
    ? [[
        { label: t('board.menu.webhooks'), icon: 'i-lucide-webhook', onSelect: () => { webhooksOpen.value = true } },
        ...(archived.value
          ? [{ label: t('board.menu.unarchive'), icon: 'i-lucide-archive-restore', onSelect: () => setArchived(false) }]
          : [
              { label: t('board.menu.background'), icon: 'i-lucide-image', onSelect: () => { backgroundOpen.value = true } },
              { label: t('board.menu.rename'), icon: 'i-lucide-pencil', onSelect: async () => {
                const name = (await ask({ title: t('board.menu.rename'), label: t('board.menu.namePrompt'), initial: board.value?.name }))?.trim()
                if (name) renameBoard(name)
              } },
              { label: t('board.menu.archive'), icon: 'i-lucide-archive', onSelect: async () => {
                if (await confirm({ title: t('board.menu.archiveConfirm'), confirmLabel: t('board.menu.archive'), color: 'primary' })) setArchived(true)
              } },
            ]),
        { label: t('board.menu.delete'), icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => { confirmDelete.value = true } },
      ]]
    : []),
  [
    {
      label: t('board.menu.tagNames'),
      icon: 'i-lucide-tag',
      type: 'checkbox' as const,
      checked: labels.value.tagNames,
      onUpdateChecked: (tagNames: boolean) => setLabelDisplay({ tagNames }),
      onSelect: (e: Event) => e.preventDefault(),
    },
    ...(columnGroups.value.length
      ? [{
          label: t('board.menu.groupNames'),
          icon: 'i-lucide-columns-3',
          type: 'checkbox' as const,
          checked: labels.value.groupNames,
          onUpdateChecked: (groupNames: boolean) => setLabelDisplay({ groupNames }),
          onSelect: (e: Event) => e.preventDefault(),
        }]
      : []),
  ],
])
</script>

<template>
  <!-- Calendar, list, timeline and swimlane views fit the window below the site header and scroll inside it.
       The plain board view lets the page scroll, so its toolbar sticks below the site header. -->
  <div
    v-if="board"
    class="flex flex-col min-h-0"
    :class="view !== 'board' || groupBy !== 'none' ? 'flex-none h-[calc(100dvh-var(--ui-header-height))]' : 'flex-1'"
    :style="bgStyle"
  >
    <div class="sticky top-(--ui-header-height) z-20" :class="backed ? 'bg-default/85 backdrop-blur-sm' : 'bg-default/75 backdrop-blur'">
      <div class="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-2.5 border-b border-default">
        <UTooltip :text="t('board.allBoards')">
          <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" :aria-label="t('board.allBoards')" />
        </UTooltip>
        <div class="min-w-0 flex items-center gap-1.5 text-lg">
          <template v-if="board.team">
            <ULink :to="`/teams/${board.team.id}`" class="text-muted hover:underline truncate shrink-[2]">
              {{ board.team.name }}
            </ULink>
            <span class="text-dimmed" aria-hidden="true">/</span>
          </template>
          <h1 class="font-semibold truncate">
            {{ board.name }}
          </h1>
        </div>
        <UTooltip :text="board.starred ? t('board.unstar') : t('board.star')">
          <UButton
            color="neutral"
            variant="ghost"
            :class="board.starred ? 'text-warning' : 'text-dimmed'"
            :aria-label="board.starred ? t('board.unstar') : t('board.star')"
            :aria-pressed="board.starred"
            @click="toggleStar(board)"
          >
            <template #leading>
              <UIcon name="i-lucide-star" mode="svg" class="size-5" :class="board.starred && '[&_*]:fill-current'" />
            </template>
          </UButton>
        </UTooltip>
        <UBadge v-if="archived" color="warning" variant="subtle" icon="i-lucide-archive" :label="t('board.archivedBadge')" />
        <UTooltip v-else-if="offline" :text="t('pwa.readOnlyHint')">
          <UBadge color="warning" variant="subtle" icon="i-lucide-wifi-off" :label="t('pwa.readOnly')" />
        </UTooltip>
        <UBadge v-else-if="!canEdit" color="neutral" variant="subtle" icon="i-lucide-eye" :label="t('board.viewOnly')" />
        <div class="order-last basis-full 2xl:order-none 2xl:basis-0 2xl:flex-1 min-w-0 flex flex-wrap items-center gap-2">
          <USeparator orientation="vertical" class="h-6 mx-1 hidden 2xl:block" />
          <UTabs v-model="view" :items="viewItems" :content="false" size="sm" :aria-label="t('board.viewLabel')" />
          <USelect
            v-if="view === 'board'"
            v-model="groupBy"
            :items="groupByItems(fields, t)"
            icon="i-lucide-rows-3"
            class="w-40"
            :aria-label="t('board.swimlanes')"
          />
          <USelect
            v-if="view === 'board' && columnGroups.length"
            v-model="columnGroupModel"
            :items="columnGroupItems"
            icon="i-lucide-columns-3"
            class="w-40"
            :aria-label="t('columnGroups.show')"
          />
          <USeparator orientation="vertical" class="h-6 mx-1 hidden sm:block" />
          <BoardFilters ref="filters" v-model="filter" class="flex-1 min-w-0" :tags="tags" :fields="fields" :members="board.members" :shown="visibleIds.size" :total="allCards.length" />
          <USeparator orientation="vertical" class="h-6 mx-1 hidden 2xl:block" />
        </div>
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
    </div>

    <div v-if="archived" :class="backed && 'bg-default/85 backdrop-blur-sm'">
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-archive"
        :title="t('board.archivedTitle')"
        :description="isOwner ? t('board.archivedOwner') : t('board.archivedMember')"
        :actions="isOwner ? [{ label: t('board.unarchive'), icon: 'i-lucide-archive-restore', color: 'warning', variant: 'solid', onClick: () => setArchived(false) }] : []"
        class="mx-4 sm:mx-6 my-3 w-auto"
      />
    </div>

    <div v-if="view === 'list'" class="flex-1 min-h-0 overflow-auto p-4 sm:p-6">
      <BoardListView
        :class="panel"
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
    <div v-else-if="view === 'calendar'" class="flex-1 min-h-0 overflow-auto p-4 sm:p-6">
      <BoardCalendarView
        :class="panel"
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
      <BoardTimelineView :class="panel" :cards="visibleCards" :columns="columns" :today="today" @open="cardId => editingCardId = cardId" />
    </div>
    <div v-else-if="groupBy !== 'none'" class="flex-1 min-h-0 overflow-auto">
      <BoardSwimlanes
        :class="panel"
        :group-by="groupBy"
        :columns="shownColumns"
        :column-width="columnWidths.widthOf"
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
        @delete="deleteCard"
        @move="moveToLane"
        @dragging="v => dragging = v"
        @rename="(card, title) => updateCard(card, { title })"
      />
    </div>
    <div v-else class="flex-1 overflow-x-auto">
      <div class="flex items-start gap-4 p-4 sm:p-6 min-h-full w-max min-w-full">
        <VueDraggable
          v-model="columns"
          :disabled="!canEdit || !!shownGroup"
          handle=".column-handle"
          :animation="150"
          class="flex items-start gap-4"
          @start="dragging = true"
          @end="dragging = false"
          @update="onColumnDrop"
        >
          <section
            v-for="col in columns"
            v-show="shownColumnIds.has(col.id)"
            :key="col.id"
            class="relative shrink-0 rounded-lg ring flex flex-col max-h-[calc(100vh-14rem)]"
            :class="[wipState(col) === 'over' ? 'ring-error' : 'ring-default', backed ? 'bg-elevated/95 shadow-lg' : 'bg-elevated/60']"
            :style="columnWidths.styleOf(col.id)"
          >
            <UTooltip :content="{ side: 'right' }" :text="t('board.column.resizeHint')">
              <div
                role="separator"
                aria-orientation="vertical"
                tabindex="0"
                :aria-label="t('board.column.resize')"
                :aria-valuenow="columnWidths.widthOf(col.id)"
                :aria-valuemin="COLUMN_WIDTH_MIN"
                :aria-valuemax="COLUMN_WIDTH_MAX"
                class="absolute inset-y-0 -right-2.5 z-10 w-3 cursor-col-resize touch-none group/resize flex justify-center focus:outline-none"
                @pointerdown="columnWidths.startResize(col.id, $event)"
                @dblclick="columnWidths.resetWidth(col.id)"
                @keydown="columnWidths.onResizeKey(col.id, $event)"
              >
                <span
                  class="w-0.5 h-full rounded-full transition-colors group-hover/resize:bg-primary group-focus-visible/resize:bg-primary"
                  :class="columnWidths.resizing.value === col.id ? 'bg-primary' : 'bg-transparent'"
                />
              </div>
            </UTooltip>
            <header
              class="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 rounded-t-lg"
              :style="col.color ? { backgroundColor: col.color, color: contrastText(col.color) } : undefined"
            >
              <UIcon v-if="canEdit && !shownGroup" name="i-lucide-grip-vertical" class="column-handle cursor-grab" :class="col.color ? 'opacity-60' : 'text-dimmed'" />
              <input
                v-if="renamingColumnId === col.id"
                :ref="focusRenameInput"
                v-model="columnTitleDraft"
                maxlength="100"
                :aria-label="t('board.column.titlePrompt')"
                class="min-w-0 flex-1 font-medium bg-default text-default rounded px-1 -mx-1 outline-none ring ring-primary"
                @keydown.enter.prevent="finishColumnRename(col, true)"
                @keydown.esc.stop.prevent="finishColumnRename(col, false)"
                @blur="finishColumnRename(col, true)"
              >
              <h2
                v-else
                class="min-w-0 flex-1 font-medium truncate"
                :class="canEdit && 'cursor-text select-none'"
                @dblclick="startColumnRename(col)"
              >
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
              <div v-if="columnChips(col).length" class="basis-full flex flex-wrap items-center gap-1 border-t border-current/15 pt-1.5">
                <UTooltip v-for="g in columnChips(col)" :key="g.id" :disabled="labels.groupNames" :text="g.name">
                  <button
                    type="button"
                    class="cursor-pointer rounded ring ring-inset ring-black/10 hover:opacity-80"
                    :style="g.color ? { backgroundColor: g.color, color: contrastText(g.color) } : undefined"
                    :class="[!g.color && 'bg-accented text-default', labels.groupNames ? 'inline-flex items-center gap-1 px-1.5 text-xs leading-5' : 'h-2 w-8 rounded-full']"
                    :aria-label="t('columnGroups.showOnly', { name: g.name })"
                    @click="showColumnGroup(g.id)"
                  >
                    <template v-if="labels.groupNames">
                      <UIcon name="i-lucide-columns-3" class="size-3 shrink-0" />{{ g.name }}
                    </template>
                  </button>
                </UTooltip>
              </div>
            </header>

            <VueDraggable
              v-model="lists[col.id]!"
              group="cards"
              :disabled="dragDisabled"
              :animation="150"
              filter=".card-title-edit"
              :prevent-on-filter="false"
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
                @delete="deleteCard(card)"
                @select="toggleSelected(card.id)"
                @rename="title => updateCard(card, { title })"
              />
            </VueDraggable>

            <div v-if="canEdit" class="px-3 pb-3 flex items-start gap-1">
              <InlineAdd :ref="el => { cardAdds[col.id] = el as { open: () => void } | null }" :label="t('board.addCard')" :placeholder="t('board.cardTitle')" :maxlength="CARD_TITLE_MAX" class="flex-1 min-w-0" @add="title => addCard(col.id, title)" />
              <UDropdownMenu v-if="templates.length" :items="templateMenu(col)" :content="{ align: 'end' }">
                <UTooltip :text="t('board.fromTemplate')">
                  <UButton color="neutral" variant="ghost" icon="i-lucide-file-plus" :aria-label="t('board.addFromTemplate')" />
                </UTooltip>
              </UDropdownMenu>
            </div>
          </section>
        </VueDraggable>

        <div v-if="canEdit" class="w-72 shrink-0" :class="backed && 'bg-default/85 backdrop-blur-sm rounded-lg p-1'">
          <InlineAdd :label="t('board.addColumn')" :placeholder="t('board.columnTitle')" @add="title => addColumn(title, shownGroup?.id)" />
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
      :link="editingTemplate ? undefined : cardLink"
      :recurrence="editingTemplate ? recurrences.find(r => r.templateId === editingCard!.id) ?? null : null"
      @update-tag="updateTag"
      @save="patch => updateCard(editingCard!, patch)"
      @counts="counts => setCardCounts(editingCard!, counts)"
      @archive="archiveCard(editingCard!)"
      @delete="editingTemplate ? deleteTemplate(editingCard!) : deleteCard(editingCard!)"
      @save-template="withAssignees => saveAsTemplate(editingCard!, withAssignees)"
      @set-recurrence="input => setRecurrence(editingCard!, input)"
      @delete-recurrence="deleteRecurrence(editingCard!)"
      @open-card="openLinkedCard"
      @link="(link, added) => cardLinkChanged(editingCard!, link, added)"
      @set-field="(field, value) => setFieldValue(editingCard!, field, value)"
      @move="columnId => moveCard(editingCard!, columnId)"
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
    <ColumnGroupsModal
      v-model:open="columnGroupsOpen"
      v-model:groups="columnGroups"
      :columns="columns"
      @create="addColumnGroup"
      @update="updateColumnGroup"
      @move="columnGroupMoved"
      @delete="deleteColumnGroup"
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
    <TrashSlideover
      v-model:open="trashOpen"
      :board-id="board.id"
      :columns="columns"
      :version="remoteVersion"
      :restore="restoreTrashedCard"
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
    <BoardAutomationsModal
      v-model:open="automationsOpen"
      :automations="automations"
      :tags="tags"
      :can-edit="canEdit"
      @add="addAutomation"
      @update="updateAutomation"
      @delete="deleteAutomation"
    />
    <BoardActivitySlideover v-model:open="activityOpen" :board-id="board.id" :version="remoteVersion" />
    <BoardBackgroundModal
      v-if="isOwner"
      v-model:open="backgroundOpen"
      :board-id="board.id"
      :background="board.background"
      :accent="board.accent"
      :upload="uploadBackground"
      @set="setBackground"
      @set-accent="setAccent"
    />
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
  </div>
</template>
