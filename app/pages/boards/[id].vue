<script setup lang="ts">
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { BulkCardAction, Card, Column, MemberAccess, SavedView } from '#shared/types/board'
import type { BoardMatrixRoom } from '#shared/types/matrix'
import type { BoardButton } from '#shared/buttons'
import { backgroundStyle } from '#shared/boardBackgrounds'
import { columnOutlineStyle, effectiveColumnOutline } from '#shared/columnOutline'
import { CARD_TITLE_MAX } from '#shared/cards'
import type { CardBox } from '~/utils/cardFocus'
import type { QuickEditMode } from '~/utils/shortcuts'

const route = useRoute()
const id = route.params.id as string
const boardTabs = useBoardTabs()
const {
  board, error, refresh, columns, columnGroups, assigneeGroups, savedViews, buttons, lists, tags, fields, templates, recurrences, automations, rules, scheduledActions, archived, offline, canEdit, isOwner, limited, canEditCard, canCommentOn, canAddToColumn, dragging, remoteVersion,
  renameBoard, setArchived, setBackground, setAccent, setButtonAlign, setColumnOutline, uploadBackground, deleteBoard, addColumn, renameColumn, setColumnAppearance, setColumnWipLimit, sortColumnByPriority, deleteColumn, columnMoved,
  addColumnRule, deleteColumnRule, addAutomation, updateAutomation, deleteAutomation, addRule, updateRule, deleteRule, addScheduledAction, deleteScheduledAction, addCard, updateCard, setCardCounts, cardLinkChanged, archiveCard, snoozeCard, wakeCard, restoreCard, deleteCard, restoreTrashedCard,
  deleteArchivedCard, cardMoved, moveCard, addTag, updateTag, deleteTag,
  addField, updateField, fieldMoved, deleteField, setFieldValue,
  addColumnGroup, updateColumnGroup, columnGroupMoved, deleteColumnGroup, addAssigneeGroup, updateAssigneeGroup, deleteAssigneeGroup, addSavedView, updateSavedView, deleteSavedView, addButton, updateButton, deleteButton, runButton, setButtonOnCard,
  addCardFromTemplate, saveAsTemplate, deleteTemplate, setRecurrence, deleteRecurrence, bulkUpdate, undo, redo, undoGroup,
} = await useBoard(id)
const { t } = useI18n()
const confirm = useConfirm()
const ask = usePrompt()
const i18n = useI18nContext()

if (error.value) {
  // A board that is gone or out of reach should not stay among the open tabs.
  boardTabs.forget(id)
  throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: t('board.notFound'), fatal: true })
}

useHead({ title: () => board.value?.name ?? t('board.title') })

const toggleStar = useBoardStar()

// Open board tabs (personal, this device): this board joins them and keeps its name current.
onMounted(() => watch(() => board.value?.name, (name) => {
  if (name) boardTabs.remember({ id, name })
}, { immediate: true }))

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

// Per-member limits (owners): which non-owners are limited, and the dialog editing them.
const limitedIds = computed(() => {
  const b = board.value
  if (!b) return []
  return b.members.filter(m => m.role !== 'owner' && b.memberAccess[m.userId]).map(m => m.userId)
})
const canLimit = (m: { userId: string }) =>
  isOwner.value && !archived.value && board.value?.members.find(x => x.userId === m.userId)?.role !== 'owner'
const limitingUserId = ref<string | null>(null)
const limitingMember = computed(() => board.value?.members.find(m => m.userId === limitingUserId.value) ?? null)
const accessOpen = computed({ get: () => !!limitingMember.value, set: (v) => { if (!v) limitingUserId.value = null } })
const accessSaving = ref(false)
const accessError = useApiError()
async function saveAccess(access: MemberAccess | null) {
  const userId = limitingUserId.value
  if (!userId) return
  accessSaving.value = true
  try {
    const url = `/api/boards/${id}/members/${userId}/access`
    if (access) await api(url, { method: 'PUT', body: access })
    else await api(url, { method: 'DELETE' })
    limitingUserId.value = null
  }
  catch (err) { accessError(err, t('memberAccess.saveFailed')) }
  finally { accessSaving.value = false }
  await refresh()
}

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
// Open cards that block another open card (see blockingCardIds).
const blockingIds = computed(() => blockingCardIds(allCards.value, columns.value))

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
const snoozedOpen = ref(false)
const trashOpen = ref(false)
const activityOpen = ref(false)
const copyOpen = ref(false)
const templatesOpen = ref(false)
const webhooksOpen = ref(false)
const botsOpen = ref(false)
const matrixOpen = ref(false)
function setMatrixRoom(room: BoardMatrixRoom | null) {
  if (board.value) board.value.matrix = room
}
const automationsOpen = ref(false)
const boardRulesOpen = ref(false)
// Column preselected in the automations dialog when opened from a column's menu.
const automationsColumnId = ref<string | null>(null)
// Card whose automations the dialog shows (opened from the card dialog); null = the board's.
const automationsCardId = ref<string | null>(null)
const automationsCard = computed(() => automationsCardId.value ? allCards.value.find(c => c.id === automationsCardId.value) ?? null : null)
function openAutomations(columnId: string | null = null, cardId: string | null = null) {
  automationsColumnId.value = columnId
  automationsCardId.value = cardId
  automationsOpen.value = true
}
/** Own automations and scheduled actions of a card (shown on the card dialog's button). */
const cardAutomationCount = (cardId: string) =>
  automations.value.filter(a => a.cardId === cardId).length + scheduledActions.value.filter(s => s.cardId === cardId).length

function openTemplate(template: Card) {
  templatesOpen.value = false
  editingCardId.value = template.id
}

/** "From template" menu of a column: adds a copy of the template at the end of it. */
function templateMenu(col: Column) {
  return [templates.value.map(tpl => ({ label: tpl.title, icon: 'i-lucide-file-text', onSelect: async () => revealCard(await addCardFromTemplate(col.id, tpl)) }))]
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
const visibleIds = computed(() => new Set(allCards.value.filter(c => matchesFilter(c, filter.value, today.value, assigneeGroups.value)).map(c => c.id)))
// Limited members drag the cards they may edit (others carry .card-locked, filtered
// out of dragging) into the columns they may edit (group put).
const dragDisabled = computed(() => (!canEdit.value && !limited.value) || filtering.value)
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
  ...columnGroups.value.map(g => ({ label: g.name, value: g.id, color: g.color ?? undefined })),
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
const assigneeGroupsOpen = ref(false)
const buttonsOpen = ref(false)
const cardButtons = computed(() => buttons.value.filter(b => b.scope === 'card'))
// Card buttons whose columns the user may change from the column's rules (shared ones need edit rights).
const manageableCardButtons = computed(() => cardButtons.value.filter(b => !b.shared || canEdit.value))
// Shared card buttons: the ones column rules can add to or remove from cards.
const sharedCardButtons = computed(() => cardButtons.value.filter(b => b.shared))
const buttonError = useApiError()
async function setButtonColumns(button: BoardButton, columnIds: string[] | null) {
  try {
    await updateButton(button, { columnIds })
  }
  catch (err) {
    buttonError(err, t('buttons.errors.save'))
  }
}
const boardButtons = computed(() => buttons.value.filter(b => b.scope === 'board'))
const boardButtonItems = computed(() => [
  boardButtons.value.map(b => ({ label: b.name, icon: b.icon ?? 'i-lucide-zap', slot: 'button' as const, iconColor: buttonCssColor(b.color), onSelect: () => runButton(b) })),
  [{ label: t('buttons.manage'), icon: 'i-lucide-settings-2', onSelect: () => { buttonsOpen.value = true } }],
])
// The swimlane select shows the chosen grouping's icon; the generic rows icon when none.
const groupByOptions = computed(() => groupByItems(fields.value, t))
const groupByIcon = computed(() => groupBy.value === 'none' ? 'i-lucide-rows-3' : groupByOptions.value.find(i => i.value === groupBy.value)?.icon ?? 'i-lucide-rows-3')
// View, swimlane and column tag selects show only their icon on phones, so the toolbar fits one row.
// On wider screens the swimlane and column tag selects do so at compaction steps 4 and 5 of
// useToolbarFit (data-c4 / data-c5; class names spelled out so Tailwind finds them).
const iconOnlyOnPhones = {
  base: 'max-sm:h-8 max-sm:w-8 max-sm:p-0',
  leading: 'max-sm:inset-0 max-sm:p-0 max-sm:justify-center',
  value: 'max-sm:sr-only',
  placeholder: 'max-sm:sr-only',
  trailing: 'max-sm:hidden',
  content: 'min-w-48',
}
const iconOnlyAtC4 = {
  base: `${iconOnlyOnPhones.base} group-data-c4/tb:w-8 group-data-c4/tb:p-0`,
  leading: `${iconOnlyOnPhones.leading} group-data-c4/tb:inset-0 group-data-c4/tb:p-0 group-data-c4/tb:justify-center`,
  value: `${iconOnlyOnPhones.value} group-data-c4/tb:sr-only`,
  placeholder: `${iconOnlyOnPhones.placeholder} group-data-c4/tb:sr-only`,
  trailing: `${iconOnlyOnPhones.trailing} group-data-c4/tb:hidden`,
  content: iconOnlyOnPhones.content,
}
const iconOnlyAtC5 = {
  base: `${iconOnlyOnPhones.base} group-data-c5/tb:w-8 group-data-c5/tb:p-0`,
  leading: `${iconOnlyOnPhones.leading} group-data-c5/tb:inset-0 group-data-c5/tb:p-0 group-data-c5/tb:justify-center`,
  value: `${iconOnlyOnPhones.value} group-data-c5/tb:sr-only`,
  placeholder: `${iconOnlyOnPhones.placeholder} group-data-c5/tb:sr-only`,
  trailing: `${iconOnlyOnPhones.trailing} group-data-c5/tb:hidden`,
  content: iconOnlyOnPhones.content,
}

// Saved views: the view, grouping, column group and filter under a name.
const currentView = computed(() => currentViewConfig({ view: view.value, groupBy: groupBy.value, columnGroupId: columnGroupId.value, filter: filter.value }))
function applySavedView(saved: SavedView) {
  const next = sanitizeViewConfig(saved.config, { tags: tags.value, members: board.value?.members ?? [], fields: fields.value, columnGroups: columnGroups.value, assigneeGroups: assigneeGroups.value })
  if (view.value !== next.view) view.value = next.view
  groupBy.value = next.groupBy
  showColumnGroup(next.columnGroupId)
  filter.value = next.filter
}
/** Turns off swimlanes, the column tag and every filter; the view (board, list, …) stays. */
function resetView() {
  groupBy.value = 'none'
  showColumnGroup(null)
  filter.value = emptyFilter()
}

// Tag and column group chips: names or colour only (personal, all boards).
const labels = useLabelDisplay()
onMounted(loadLabelDisplay)

// Column widths (drag a column's right edge; personal, per board).
const columnWidths = useColumnWidths(id, computed(() => columns.value.map(c => c.id)))
// Collapsed columns (narrow strip with title and count; personal, per board).
const collapsedColumns = useCollapsedColumns(id, computed(() => columns.value.map(c => c.id)))

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

/** Scrolls a just-added card into view (its column scrolls once it is full). */
async function revealCard(card: { id: string } | undefined) {
  if (!card) return
  await nextTick()
  document.querySelector(`[data-card-id="${card.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
}

/** Ctrl/Cmd+Enter in the add box (`open`) also opens the new card. */
async function addCardAndReveal(columnId: string, title: string, open = false) {
  const card = await addCard(columnId, title)
  revealCard(card)
  if (open && card) editingCardId.value = card.id
}

// Board shortcuts (listed in app/utils/shortcuts.ts). defineShortcuts skips them
// while typing; they also skip while a dialog is open.
const filters = useTemplateRef<{ focus: () => void }>('filters')
useToolbarFit(useTemplateRef<HTMLElement>('toolbar'), 5)
const cardAdds: Record<string, { open: () => void } | null> = {}
defineShortcuts({
  '/': () => { if (!dialogOpen()) filters.value?.focus() },
  'n': () => {
    const first = shownColumns.value.find(c => !collapsedColumns.isCollapsed(c.id))
    if (canEdit.value && first && !dialogOpen()) cardAdds[first.id]?.open()
  },
  // Not while typing, so text fields keep their own undo; works in dialogs too.
  'meta_z': () => { undo() },
  'meta_shift_z': () => { redo() },
  'g-t': () => {
    const next = dialogOpen() ? null : stepBoardTab(boardTabs.tabs.value, id, 1)
    if (next) navigateTo(`/boards/${next}`)
  },
})

// Escape clears the card selection. Not a defineShortcuts entry: those call preventDefault,
// and the open dialog (card, confirm, slideover) then ignores Escape instead of closing.
function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || !selecting.value || dialogOpen()) return
  const el = e.target as HTMLElement | null
  if (el?.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return
  clearSelection()
}
onMounted(() => document.addEventListener('keydown', onEscape))
onBeforeUnmount(() => document.removeEventListener('keydown', onEscape))

// Keyboard card navigation in the board view (also with swimlanes; listed in shortcutGroups).
// Arrow keys / h j k l move the focus between cards by their place on screen (`neighbourCard`);
// with nothing focused they start at the first card. On the focused card: `a` assigns or
// unassigns me, `[` / `]` move it to the end of the previous / next shown column. Enter, `e`
// and `x` are handled by BoardCard itself. Plain listener rather than defineShortcuts, so keys
// only count on a card (or on nothing), never in menus, buttons or fields.
const { user } = useUserSession()
function cardElements() {
  return [...document.querySelectorAll<HTMLElement>('[data-card-id]')].filter(el => el.getClientRects().length > 0)
}
function cardBox(el: HTMLElement): CardBox {
  const r = el.getBoundingClientRect()
  return { id: el.dataset.cardId!, left: r.left, top: r.top, width: r.width, height: r.height }
}
function focusCard(cardId: string) {
  const el = cardElements().find(e => e.dataset.cardId === cardId)
  if (!el) return
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
async function moveFocusedCard(card: Card, step: 1 | -1) {
  const index = shownColumns.value.findIndex(c => c.id === card.columnId)
  const target = index < 0 ? undefined : shownColumns.value[index + step]
  if (!target || !canEditCard(card) || !canAddToColumn(target.id)) return
  const moved = moveCard(card, target.id)
  await nextTick()
  focusCard(card.id)
  await moved
}
function onCardKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.metaKey || (e.ctrlKey && !e.altKey) || view.value !== 'board' || dialogOpen()) return
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return
  // Only the card itself or nothing focused; not a button inside a card or anywhere else.
  const cardId = target?.dataset.cardId
  if (!cardId && target !== document.body) return
  const plain = !e.altKey && !e.shiftKey && !e.ctrlKey
  const dir = plain ? focusDirection(e.key) : null
  if (dir) {
    e.preventDefault()
    const els = cardElements()
    if (!cardId) {
      const first = els.map(cardBox).sort((a, b) => a.left - b.left || a.top - b.top)[0]
      if (first) focusCard(first.id)
      return
    }
    const next = neighbourCard(cardBox(target!), els.map(cardBox), dir)
    if (next) focusCard(next)
    return
  }
  const card = cardId ? allCards.value.find(c => c.id === cardId) : undefined
  if (!card) return
  if (e.key === '[' || e.key === ']') {
    e.preventDefault()
    moveFocusedCard(card, e.key === ']' ? 1 : -1)
  }
  else if (e.key === 'a' && plain && user.value && canEditCard(card)) {
    e.preventDefault()
    const me = user.value.id
    updateCard(card, { assigneeIds: card.assigneeIds.includes(me) ? card.assigneeIds.filter(u => u !== me) : [...card.assigneeIds, me] })
  }
  else if (e.key === 'c' && plain && canEditCard(card)) {
    e.preventDefault()
    // Focus a neighbour first, so the keyboard stays on the board once the card is gone.
    const boxes = cardElements().map(cardBox)
    const next = neighbourCard(cardBox(target!), boxes, 'down') ?? neighbourCard(cardBox(target!), boxes, 'up')
    archiveCard(card)
    if (next) nextTick(() => focusCard(next))
  }
  else if (plain && canEditCard(card) && quickEditKeys[e.key] && (e.key !== 't' || tags.value.length)) {
    e.preventDefault()
    quickEdit.value = { cardId: card.id, mode: quickEditKeys[e.key]! }
    quickEditOpen.value = true
  }
}

// `d` / `t` / `m` on a focused card: due date, card tags or assignees in a small dialog.
const quickEditKeys: Record<string, QuickEditMode> = { d: 'due', t: 'tags', m: 'assignees' }
const quickEdit = ref<{ cardId: string, mode: QuickEditMode } | null>(null)
const quickEditOpen = ref(false)
const quickEditCard = computed(() => quickEdit.value ? allCards.value.find(c => c.id === quickEdit.value!.cardId) ?? null : null)
watch(quickEditOpen, (open) => {
  if (open || !quickEdit.value) return
  const cardId = quickEdit.value.cardId
  // Back to the card once the dialog has closed (and returned focus to whatever it took it from).
  setTimeout(() => focusCard(cardId), 0)
})
watch(quickEditCard, (card) => {
  if (!card) quickEditOpen.value = false
})
onMounted(() => document.addEventListener('keydown', onCardKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onCardKey))

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

/**
 * Drop target of a collapsed column: its list stays empty, the dropped card
 * goes to the end of the column. The source list drops the card itself.
 */
const collapsedDropSink: Card[] = []
function onCollapsedDrop(columnId: string, e: SortableEvent) {
  const cardId = (e.item as HTMLElement).dataset.cardId
  const card = cardId ? Object.values(lists.value).flat().find(c => c.id === cardId) : undefined
  nextTick(() => {
    collapsedDropSink.length = 0
    if (card) moveCard(card, columnId)
  })
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
    { label: t('board.column.automations'), icon: 'i-lucide-timer', onSelect: () => openAutomations(col.id) },
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

// Board menu in labelled sections; owner-only items and empty sections drop out.
const boardMenu = computed(() => {
  const owner = isOwner.value
  const editable = owner && !archived.value
  const section = (label: string, items: DropdownMenuItem[]) =>
    items.length ? [{ label, type: 'label' as const }, ...items] : []
  return [
    section(t('board.menu.sections.setup'), [
      ...(canEdit.value
        ? [
            { label: t('board.menu.fields'), icon: 'i-lucide-list-plus', onSelect: () => { fieldsOpen.value = true } },
            { label: t('board.menu.columnGroups'), icon: 'i-lucide-columns-3', onSelect: () => { columnGroupsOpen.value = true } },
            { label: t('board.menu.assigneeGroups'), icon: 'i-lucide-users', onSelect: () => { assigneeGroupsOpen.value = true } },
          ]
        : []),
      { label: t('board.menu.templates'), icon: 'i-lucide-file-stack', onSelect: () => { templatesOpen.value = true } },
      { label: t('board.menu.automations'), icon: 'i-lucide-timer', onSelect: () => openAutomations() },
      ...(limited.value ? [] : [{ label: t('board.menu.rules'), icon: 'i-lucide-workflow', onSelect: () => { boardRulesOpen.value = true } }]),
      ...(!offline.value ? [{ label: t('board.menu.buttons'), icon: 'i-lucide-zap', onSelect: () => { buttonsOpen.value = true } }] : []),
      ...(editable ? [{ label: t('board.menu.background'), icon: 'i-lucide-image', onSelect: () => { backgroundOpen.value = true } }] : []),
      ...(owner ? [{ label: t('board.menu.bots'), icon: 'i-lucide-bot', onSelect: () => { botsOpen.value = true } }] : []),
      ...(owner ? [{ label: t('board.menu.webhooks'), icon: 'i-lucide-webhook', onSelect: () => { webhooksOpen.value = true } }] : []),
      ...(owner ? [{ label: t('board.menu.matrix'), icon: 'i-lucide-message-square-share', onSelect: () => { matrixOpen.value = true } }] : []),
    ]),
    section(t('board.menu.sections.history'), [
      { label: t('board.menu.activity'), icon: 'i-lucide-history', onSelect: () => { activityOpen.value = true } },
      { label: t('board.menu.snoozed'), icon: 'i-lucide-alarm-clock', onSelect: () => { snoozedOpen.value = true } },
      { label: t('board.menu.archived'), icon: 'i-lucide-archive', onSelect: () => { archiveOpen.value = true } },
      ...(canEdit.value ? [{ label: t('board.menu.trash'), icon: 'i-lucide-trash-2', onSelect: () => { trashOpen.value = true } }] : []),
    ]),
    section(t('board.menu.sections.share'), [
      { label: t('board.menu.copy'), icon: 'i-lucide-copy', onSelect: () => { copyOpen.value = true } },
      { label: t('board.menu.exportJson'), icon: 'i-lucide-file-json', to: `${base}/api/boards/${id}/export?format=json`, external: true, download: true },
      { label: t('board.menu.exportCsv'), icon: 'i-lucide-file-spreadsheet', to: `${base}/api/boards/${id}/export?format=csv`, external: true, download: true },
    ]),
    section(t('board.menu.sections.display'), [
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
    ]),
    section(t('board.menu.sections.manage'), owner
      ? [
          ...(archived.value
            ? [{ label: t('board.menu.unarchive'), icon: 'i-lucide-archive-restore', onSelect: () => setArchived(false) }]
            : [
                { label: t('board.menu.rename'), icon: 'i-lucide-pencil', onSelect: async () => {
                  const name = (await ask({ title: t('board.menu.rename'), label: t('board.menu.namePrompt'), initial: board.value?.name }))?.trim()
                  if (name) renameBoard(name)
                } },
                { label: t('board.menu.archive'), icon: 'i-lucide-archive', onSelect: async () => {
                  if (await confirm({ title: t('board.menu.archiveConfirm'), confirmLabel: t('board.menu.archive'), color: 'primary' })) setArchived(true)
                } },
              ]),
          { label: t('board.menu.delete'), icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => { confirmDelete.value = true } },
        ]
      : []),
  ].filter(items => items.length)
})
</script>

<template>
  <!-- Calendar, list, timeline and swimlane views fit the window below the site header and scroll inside it.
       The plain board view lets the page scroll, so its toolbar sticks below the site header. -->
  <div
    v-if="board"
    class="flex flex-col min-h-0"
    :class="view !== 'board' || groupBy !== 'none' ? 'flex-none h-[calc(100dvh-var(--ui-header-height)-env(safe-area-inset-bottom))]' : 'flex-1'"
    :style="bgStyle"
  >
    <div class="sm:sticky sm:top-(--ui-header-height) z-20" :class="backed ? 'bg-default/85 backdrop-blur-sm' : 'bg-default/75 backdrop-blur'">
      <BoardTabs :active-id="id" />
      <div class="flex flex-wrap items-center gap-x-1 gap-y-2 sm:gap-3 px-2 sm:px-6 py-2 sm:py-2.5 border-b border-default">
        <UTooltip :text="t('board.allBoards')">
          <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" :aria-label="t('board.allBoards')" />
        </UTooltip>
        <div class="min-w-0 max-sm:flex-1 flex items-center gap-1.5 text-base sm:text-lg">
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
        <BoardNotificationMenu :board="board" class="-ms-2" />
        <UBadge v-if="archived" color="warning" variant="subtle" icon="i-lucide-archive" :label="t('board.archivedBadge')" />
        <UTooltip v-else-if="offline" :text="t('pwa.readOnlyHint')">
          <UBadge color="warning" variant="subtle" icon="i-lucide-wifi-off" :label="t('pwa.readOnly')" />
        </UTooltip>
        <UTooltip v-else-if="limited" :text="t('memberAccess.limitedHint')">
          <UBadge color="warning" variant="subtle" icon="i-lucide-shield" :label="t('memberAccess.limitedBadge')" />
        </UTooltip>
        <UBadge v-else-if="!canEdit" color="neutral" variant="subtle" icon="i-lucide-eye" :label="t('board.viewOnly')" />
        <!-- Compacts step by step (useToolbarFit) before it wraps: data-c1 short filter count, c2 Views/Filters
             icon only, c3 view tabs icon only, c4 swimlane select icon only, c5 column tag select icon only.
             The search box takes up the space left over. -->
        <div ref="toolbar" class="group/tb relative order-last basis-full 2xl:order-none 2xl:basis-0 2xl:flex-1 min-w-0 flex flex-wrap items-center gap-2">
          <USeparator orientation="vertical" class="h-6 mx-1 hidden 2xl:block" />
          <SavedViewsMenu
            :views="savedViews"
            :current="currentView"
            :can-share="canEdit"
            :offline="offline"
            :create="addSavedView"
            :update="updateSavedView"
            :remove="deleteSavedView"
            @apply="applySavedView"
            @reset="resetView"
          />
          <UDropdownMenu v-if="canEdit && boardButtons.length" :items="boardButtonItems">
            <template #button-leading="{ item, ui }">
              <UIcon :name="item.icon" data-slot="itemLeadingIcon" :class="ui.itemLeadingIcon()" :style="{ color: item.iconColor }" />
            </template>
            <UButton icon="i-lucide-zap" color="neutral" variant="ghost" size="sm" :aria-label="t('buttons.boardButtons')">
              <span class="group-data-c2/tb:sr-only">{{ t('buttons.boardButtons') }}</span>
            </UButton>
          </UDropdownMenu>
          <!-- Tabs from sm up; a select on phones, where four icon tabs take too much room. -->
          <UTabs v-model="view" :items="viewItems" :content="false" size="sm" class="hidden sm:flex" :ui="{ label: 'group-data-c3/tb:sr-only' }" :aria-label="t('board.viewLabel')" />
          <USelect
            v-model="view"
            :items="viewItems"
            :icon="viewIcons[view]"
            class="sm:hidden shrink-0"
            :ui="iconOnlyOnPhones"
            :aria-label="t('board.viewLabel')"
          />
          <USelect
            v-if="view === 'board'"
            v-model="groupBy"
            :items="groupByOptions"
            :icon="groupByIcon"
            class="shrink-0 sm:w-40"
            :ui="iconOnlyAtC4"
            :aria-label="t('board.swimlanes')"
          />
          <USelect
            v-if="view === 'board' && columnGroups.length"
            v-model="columnGroupModel"
            :items="columnGroupItems"
            icon="i-lucide-columns-3"
            class="shrink-0 sm:w-40"
            :ui="iconOnlyAtC5"
            :aria-label="t('columnGroups.show')"
          >
            <template #leading="{ ui }">
              <span v-if="shownGroup?.color" class="size-3 rounded-full shrink-0 ring ring-default" :style="{ backgroundColor: shownGroup.color }" />
              <UIcon v-else name="i-lucide-columns-3" :class="ui.leadingIcon()" />
            </template>
            <template #item-leading="{ item }">
              <!-- Items align to the top, sized for a size-5 icon: centre the dot in that box. -->
              <span v-if="typeof item === 'object' && 'color' in item && item.color" class="size-5 shrink-0 flex items-center justify-center">
                <span class="size-3 rounded-full ring ring-default" :style="{ backgroundColor: item.color }" />
              </span>
            </template>
          </USelect>
          <USeparator orientation="vertical" class="h-6 mx-1 hidden sm:block" />
          <BoardFilters ref="filters" v-model="filter" class="flex-1 min-w-0 sm:flex-none sm:grow" :tags="tags" :fields="fields" :members="board.members" :assignee-groups="assigneeGroups" :shown="visibleIds.size" :total="allCards.length" />
          <USeparator orientation="vertical" class="h-6 mx-1 hidden 2xl:block" />
        </div>
        <div class="ms-auto flex items-center gap-1 sm:gap-2">
          <UAvatarGroup :max="4" size="sm" class="hidden sm:flex">
            <UAvatar v-for="m in board.members" :key="m.userId" v-bind="personAvatar(m)" />
          </UAvatarGroup>
          <UButton v-if="canEdit" icon="i-lucide-tags" color="neutral" variant="outline" :aria-label="t('board.tags')" @click="tagsOpen = true">
            <span class="hidden sm:inline">{{ t('board.tags') }}</span>
          </UButton>
          <UButton icon="i-lucide-users" color="neutral" variant="outline" :aria-label="t('board.members')" @click="membersOpen = true">
            <span class="hidden sm:inline">{{ t('board.members') }}</span>
          </UButton>
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
        :collapsed="collapsedColumns.isCollapsed"
        :outline="board.columnOutline"
        :lists="lists"
        :tags="tags"
        :fields="fields"
        :members="board.members"
        :visible-ids="visibleIds"
        :blocked-ids="blockedIds"
        :blocking-ids="blockingIds"
        :can-edit="canEdit"
        :drag-disabled="dragDisabled"
        :today="today"
        @open="cardId => editingCardId = cardId"
        @delete="deleteCard"
        @move="moveToLane"
        @dragging="v => dragging = v"
        :buttons="cardButtons"
        :button-align="board.buttonAlign"
        @rename="(card, title) => updateCard(card, { title })"
        @collapse="(columnId, value) => collapsedColumns.setCollapsed(columnId, value)"
        @run-button="(b, card) => runButton(b, card)"
      />
    </div>
    <div v-else class="flex-1 overflow-x-auto snap-x snap-proximity sm:snap-none scroll-px-3">
      <div class="flex items-start gap-3 sm:gap-4 p-3 sm:p-6 min-h-full w-max min-w-full">
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
            class="group/col relative shrink-0 snap-start rounded-lg flex flex-col max-h-[calc(100dvh-14rem)]"
            :class="[!effectiveColumnOutline(col, board.columnOutline) && ['ring', wipState(col) === 'over' ? 'ring-error' : 'ring-default'], backed ? 'bg-elevated/95 shadow-lg' : 'bg-elevated/60']"
            :style="[collapsedColumns.isCollapsed(col.id) ? { width: `${COLLAPSED_COLUMN_WIDTH}px` } : columnWidths.styleOf(col.id), columnOutlineStyle(effectiveColumnOutline(col, board.columnOutline), wipState(col) === 'over', col.color) ?? {}]"
          >
            <!-- Collapsed: a narrow strip with the title and card count; click expands. Drag it to move the column; drop a card on it to move the card to the end. -->
            <VueDraggable
              v-if="collapsedColumns.isCollapsed(col.id)"
              :model-value="collapsedDropSink"
              :group="{ name: 'cards', put: canAddToColumn(col.id) }"
              :disabled="dragDisabled"
              draggable="[data-card-id]"
              class="flex flex-col rounded-lg has-[[data-card-id]]:ring-2 has-[[data-card-id]]:ring-primary [&>[data-card-id]]:hidden"
              :data-collapsed-column="col.id"
              @add="onCollapsedDrop(col.id, $event)"
            >
              <button
                type="button"
                class="flex flex-col items-center gap-2 py-2 min-h-40 rounded-lg cursor-pointer hover:bg-accented/40 focus-visible:outline-2 focus-visible:outline-primary"
                :class="canEdit && !shownGroup && 'column-handle'"
                :style="col.color ? { backgroundColor: col.color, color: contrastText(col.color) } : undefined"
                :aria-label="t('board.column.expand', { title: col.title, count: lists[col.id]?.length ?? 0 })"
                :title="t('board.column.expand', { title: col.title, count: lists[col.id]?.length ?? 0 })"
                @click="collapsedColumns.setCollapsed(col.id, false)"
              >
                <UIcon name="i-lucide-unfold-horizontal" class="size-4 shrink-0" :class="!col.color && 'text-dimmed'" />
                <UBadge
                  :color="wipState(col) === 'over' ? 'error' : wipState(col) === 'full' ? 'warning' : 'neutral'"
                  :variant="wipState(col) === 'over' ? 'solid' : 'soft'"
                  size="sm"
                  :label="col.wipLimit ? `${lists[col.id]?.length ?? 0}/${col.wipLimit}` : String(lists[col.id]?.length ?? 0)"
                />
                <span class="font-medium [writing-mode:vertical-rl] whitespace-nowrap overflow-hidden text-ellipsis max-h-[calc(100dvh-20rem)]">{{ col.title }}</span>
              </button>
            </VueDraggable>
            <template v-else>
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
                <UIcon v-if="canEdit && !shownGroup" name="i-lucide-grip-vertical" class="column-handle cursor-grab pointer-coarse:size-6" :class="col.color ? 'opacity-60' : 'text-dimmed'" />
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
                <UTooltip :text="t('board.column.collapse')">
                  <UButton
                    icon="i-lucide-fold-horizontal"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    class="pointer-coarse:p-1.5 pointer-fine:opacity-0 pointer-fine:group-hover/col:opacity-100 focus-visible:opacity-100"
                    :class="col.color && 'text-inherit hover:bg-black/10'"
                    :aria-label="t('board.column.collapse')"
                    @click="collapsedColumns.setCollapsed(col.id, true)"
                  />
                </UTooltip>
                <UDropdownMenu v-if="canEdit" :items="columnMenu(col)">
                  <UButton icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" class="pointer-coarse:p-1.5" :aria-label="t('board.column.actions')" :class="col.color && 'text-inherit hover:bg-black/10'" />
                </UDropdownMenu>
                <!-- On a coloured header the chips sit on a translucent strip so chips of the column's own colour stay visible. -->
                <div
                  v-if="columnChips(col).length"
                  class="basis-full flex flex-wrap items-center gap-1"
                  :class="col.color ? '-mx-1.5 mt-0.5 px-1.5 py-1.5 rounded-md bg-default/60' : 'border-t border-current/15 pt-1.5'"
                >
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
                :group="{ name: 'cards', put: canAddToColumn(col.id) }"
                :disabled="dragDisabled"
                :animation="150"
                :delay="200"
                :delay-on-touch-only="true"
                :touch-start-threshold="5"
                :force-auto-scroll-fallback="true"
                :scroll-sensitivity="80"
                :scroll-speed="16"
                filter=".card-title-edit, .card-locked"
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
                  :data-card-id="card.id"
                  :card="card"
                  :tags="tags"
                  :fields="fields"
                  :members="board.members"
                  :can-edit="canEditCard(card)"
                  :selectable="!limited"
                  :class="!canEditCard(card) && 'card-locked'"
                  :today="today"
                  :blocked="blockedIds.has(card.id)"
                  :blocking="blockingIds.has(card.id)"
                  :selected="selected.has(card.id)"
                  :selecting="selecting"
                  @open="editingCardId = card.id"
                  @delete="deleteCard(card)"
                  @select="toggleSelected(card.id)"
                  :buttons="cardButtons"
                  :button-align="board.buttonAlign"
                  @rename="title => updateCard(card, { title })"
                  @run-button="b => runButton(b, card)"
                />
              </VueDraggable>

              <div v-if="canAddToColumn(col.id)" class="px-3 pb-3 flex items-start gap-1">
                <InlineAdd :ref="el => { cardAdds[col.id] = el as { open: () => void } | null }" :label="t('board.addCard')" :placeholder="t('board.cardTitle')" :maxlength="CARD_TITLE_MAX" openable class="flex-1 min-w-0" @add="(title, open) => addCardAndReveal(col.id, title, open)" />
                <UDropdownMenu v-if="templates.length" :items="templateMenu(col)" :content="{ align: 'end' }">
                  <UTooltip :text="t('board.fromTemplate')">
                    <UButton color="neutral" variant="ghost" icon="i-lucide-file-plus" :aria-label="t('board.addFromTemplate')" />
                  </UTooltip>
                </UDropdownMenu>
              </div>
            </template>
          </section>
        </VueDraggable>

        <div v-if="canEdit" class="w-72 max-w-[calc(100vw-3rem)] shrink-0 snap-start" :class="backed && 'bg-default/85 backdrop-blur-sm rounded-lg p-1'">
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
      :assignee-groups="assigneeGroups"
      @apply="applyBulk"
      @clear="clearSelection"
    />
    <CardQuickEdit
      v-if="quickEdit && quickEditCard"
      v-model:open="quickEditOpen"
      :card="quickEditCard"
      :mode="quickEdit.mode"
      :tags="tags"
      :members="board.members"
      @update="patch => updateCard(quickEditCard!, patch)"
    />
    <CardModal
      v-if="editingCard"
      v-model:open="cardOpen"
      :card="editingCard"
      :members="board.members"
      :assignee-groups="assigneeGroups"
      :tags="tags"
      :fields="fields"
      :cards="allCards"
      :columns="columns"
      :can-edit="canEditCard(editingCard)"
      :can-comment="canCommentOn(editingCard)"
      :can-create-tags="canEdit"
      :move-column-ids="limited ? columns.filter(c => canAddToColumn(c.id)).map(c => c.id) : undefined"
      :is-owner="isOwner && !archived"
      :can-react="!archived && !offline"
      :create-tag="addTag"
      :remote-version="remoteVersion"
      :template="editingTemplate"
      :link="editingTemplate ? undefined : cardLink"
      :matrix="board.matrix"
      :automation-count="editingTemplate ? undefined : cardAutomationCount(editingCard.id)"
      :recurrence="editingTemplate ? recurrences.find(r => r.templateId === editingCard!.id) ?? null : null"
      @update-tag="updateTag"
      @save="patch => updateCard(editingCard!, patch)"
      @counts="counts => setCardCounts(editingCard!, counts)"
      @archive="archiveCard(editingCard!)"
      @snooze="until => snoozeCard(editingCard!, until)"
      @delete="editingTemplate ? deleteTemplate(editingCard!) : deleteCard(editingCard!)"
      @save-template="withAssignees => saveAsTemplate(editingCard!, withAssignees)"
      @set-recurrence="input => setRecurrence(editingCard!, input)"
      @delete-recurrence="deleteRecurrence(editingCard!)"
      @open-card="openLinkedCard"
      @link="(link, added) => cardLinkChanged(editingCard!, link, added)"
      @set-field="(field, value) => setFieldValue(editingCard!, field, value)"
      @move="columnId => moveCard(editingCard!, columnId)"
      :buttons="editingTemplate ? undefined : cardButtons"
      :button-align="board.buttonAlign"
      @automations="openAutomations(null, editingCard!.id)"
      @run-button="b => runButton(b, editingCard!)"
      @button-on-card="(b, on) => setButtonOnCard(b, editingCard!, on)"
    />
    <ColumnColorModal
      v-if="colouringColumn"
      v-model:open="colourOpen"
      :title="colouringColumn.title"
      :color="colouringColumn.color"
      :outline="colouringColumn.outline"
      :board-outline="board.columnOutline"
      @save="value => setColumnAppearance(colouringColumn!, value)"
    />
    <ColumnRulesModal
      v-if="rulesColumn"
      v-model:open="rulesOpen"
      :column="rulesColumn"
      :tags="tags"
      :members="board?.members ?? []"
      :cards="lists[rulesColumn.id] ?? []"
      :buttons="manageableCardButtons"
      :rule-buttons="sharedCardButtons"
      :column-ids="columns.map(c => c.id)"
      @add="(rule, applyToExisting) => addColumnRule(rulesColumn!, rule, applyToExisting)"
      @delete="rule => deleteColumnRule(rulesColumn!, rule)"
      @button-columns="setButtonColumns"
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
    <BoardButtonsModal
      v-model:open="buttonsOpen"
      :buttons="buttons"
      :columns="columns"
      :tags="tags"
      :members="board.members"
      :can-edit="canEdit"
      :create="addButton"
      :update="updateButton"
      :remove="deleteButton"
      :align="board.buttonAlign"
      :can-set-align="isOwner && !archived && !offline"
      @set-align="setButtonAlign"
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
    <AssigneeGroupsModal
      v-model:open="assigneeGroupsOpen"
      :groups="assigneeGroups"
      :members="board.members"
      @create="addAssigneeGroup"
      @update="updateAssigneeGroup"
      @delete="deleteAssigneeGroup"
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
    <SnoozedSlideover
      v-model:open="snoozedOpen"
      :board-id="board.id"
      :columns="columns"
      :can-edit="canEdit"
      :version="remoteVersion"
      :wake="wakeCard"
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
    <BoardRulesModal
      v-if="boardRulesOpen"
      v-model:open="boardRulesOpen"
      :rules="rules"
      :tags="tags"
      :columns="columns"
      :members="board?.members ?? []"
      :can-edit="canEdit"
      @add="addRule"
      @update="updateRule"
      @delete="deleteRule"
    />
    <!-- Mounted on open, so its portal comes after an open card dialog and stacks over it. -->
    <BoardAutomationsModal
      v-if="automationsOpen"
      v-model:open="automationsOpen"
      :automations="automations"
      :tags="tags"
      :columns="columns"
      :column-id="automationsColumnId"
      :cards="allCards"
      :card="automationsCard"
      :scheduled-actions="scheduledActions"
      :can-edit="canEdit"
      @add="addAutomation"
      @update="updateAutomation"
      @delete="deleteAutomation"
      @schedule="action => automationsCard && addScheduledAction(automationsCard, action)"
      @unschedule="deleteScheduledAction"
      @skip="skip => automationsCard && updateCard(automationsCard, { skipAutomations: skip })"
    />
    <BoardActivitySlideover v-model:open="activityOpen" :board-id="board.id" :version="remoteVersion" />
    <BoardBackgroundModal
      v-if="isOwner"
      v-model:open="backgroundOpen"
      :board-id="board.id"
      :background="board.background"
      :accent="board.accent"
      :column-outline="board.columnOutline"
      :upload="uploadBackground"
      @set="setBackground"
      @set-accent="setAccent"
      @set-column-outline="setColumnOutline"
    />
    <BotsSlideover
      v-if="isOwner"
      v-model:open="botsOpen"
      :board-id="board.id"
      :bots="board.bots ?? []"
      :limited-ids="limitedIds"
      :can-limit="!archived"
      @limit="botId => limitingUserId = botId"
      @changed="refresh"
    />
    <WebhooksSlideover v-if="isOwner" v-model:open="webhooksOpen" :board-id="board.id" />
    <MatrixSlideover v-if="isOwner" v-model:open="matrixOpen" :board-id="board.id" :room="board.matrix" @update:room="setMatrixRoom" />
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
      :limited-ids="limitedIds"
      :can-limit="canLimit"
      @limit="userId => limitingUserId = userId"
      @changed="refresh"
      @left="navigateTo('/')"
    />
    <MemberAccessModal
      v-if="limitingMember"
      v-model:open="accessOpen"
      :member="limitingMember"
      :columns="columns"
      :cards="allCards"
      :access="board.memberAccess[limitingMember.userId] ?? null"
      :saving="accessSaving"
      @save="saveAccess"
      @remove="saveAccess(null)"
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
