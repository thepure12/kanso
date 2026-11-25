<script setup lang="ts">
import type { BoardDetail, Card, Column, Member } from '#shared/types/board'
import type { BoardButton, ButtonRunResult } from '#shared/buttons'
import type { CustomView } from '#shared/types/customViews'
import type { BoardAccent } from '#shared/boardAccents'
import { type BoardBackground, backgroundStyle } from '#shared/boardBackgrounds'
import { CARD_TITLE_MAX } from '#shared/cards'
import { type ColumnOutline, columnOutlineStyle, effectiveColumnOutline } from '#shared/columnOutline'
import type { ViewColumnRequest } from '~/components/ViewColumnTools.vue'

// A custom view: the person's chosen columns from several boards side by side.
// Each board loads through GET /api/boards/:id (RLS decides what shows); cards
// look and act as on the board (complete, rename, delete, card buttons) and open
// in the full card dialog of their board, but are not dragged here. Columns have
// the board's controls (menu, inline rename) plus their own collapse and width.
const route = useRoute()
const { t } = useI18n()
const i18n = useI18nContext()
const confirm = useConfirm()
const showError = useApiError()
const toast = useToast()
const requestFetch = useRequestFetch()
const id = route.params.id as string

const boardTabs = useBoardTabs()
const { data: view, error, refresh: refreshView } = await useFetch<CustomView>(`/api/views/${id}`)
if (error.value) {
  boardTabs.forget(id)
  throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: t('customViews.notFound'), fatal: true })
}
useHead({ title: () => view.value?.name ?? t('customViews.title') })

// The view is a tab in the board tab strip (shown above the header), like boards.
onMounted(() => watch(() => view.value?.name, (name) => {
  if (name) boardTabs.remember({ id, name, kind: 'view' })
}, { immediate: true }))
defineShortcuts({
  'g-t': () => {
    const next = dialogOpen() ? null : stepBoardTab(boardTabs.tabs.value, id, 1)
    if (next) navigateTo(boardTabPath(next))
  },
})

// The view's own look, as on a board page: background (translucent panels over
// it), accent colour while the page is open, and a default column outline that
// replaces each board's (a column's own outline still wins).
const base = basePath()
const bgStyle = computed(() => backgroundStyle(view.value?.background, { viewId: id }, false, base, view.value?.accent))
const backed = computed(() => !!bgStyle.value)
const panel = computed(() => backed.value ? 'bg-default/95 rounded-lg p-2 sm:p-3' : undefined)
useBoardAccent(() => view.value?.accent)
const outlineOf = (col: { column: Column, board: BoardDetail }) =>
  effectiveColumnOutline(col.column, view.value?.columnOutline ?? col.board.columnOutline)

const boardIds = computed(() => [...new Set(view.value?.columns.map(c => c.boardId) ?? [])])

// Boards of the view's columns, by id. One that fails to load (gone, no access) is left out.
const boards = ref<Record<string, BoardDetail>>({})
async function fetchBoard(boardId: string) {
  try { return await requestFetch<BoardDetail>(`/api/boards/${boardId}`) }
  catch { return null }
}
async function loadBoard(boardId: string) {
  const b = await fetchBoard(boardId)
  if (b) boards.value[boardId] = b
  else delete boards.value[boardId]
}
// The boards loaded during SSR come back through the payload: a plain ref is not
// hydrated, so without seeding it from the data the columns vanished on reload.
const { data: initialBoards } = await useAsyncData(`view-boards-${id}`, async () => {
  const loaded = await Promise.all(boardIds.value.map(async b => [b, await fetchBoard(b)] as const))
  return Object.fromEntries(loaded.filter((e): e is [string, BoardDetail] => !!e[1]))
})
boards.value = initialBoards.value ?? {}

// Live updates per board: reload that board when someone else changes it.
const live = useLiveEvents()
const subscriptions = new Map<string, () => void>()
function syncSubscriptions(ids: string[]) {
  for (const [b, off] of subscriptions) {
    if (ids.includes(b)) continue
    off()
    subscriptions.delete(b)
  }
  for (const b of ids) {
    if (subscriptions.has(b) || !boards.value[b]) continue
    subscriptions.set(b, live.subscribeBoard(b, {
      change: () => loadBoard(b),
      resync: () => loadBoard(b),
      gone: () => {
        subscriptions.get(b)?.()
        subscriptions.delete(b)
        delete boards.value[b]
        refreshView()
      },
    }))
  }
}
onMounted(() => watch(() => [boardIds.value, Object.keys(boards.value)] as const, ([ids]) => syncSubscriptions(ids), { immediate: true }))
onBeforeUnmount(() => syncSubscriptions([]))

// Columns of the view whose board loaded, with their cards in board order.
const columns = computed(() => (view.value?.columns ?? []).flatMap((vc) => {
  const board = boards.value[vc.boardId]
  const column = board?.columns.find(c => c.id === vc.columnId)
  if (!board || !column) return []
  return [{ ...vc, column, title: column.title, color: column.color, board, cards: board.cards.filter(c => c.columnId === column.id) }]
}))
type ViewCol = (typeof columns.value)[number]

/** Column tags (column groups) of the column on its board, shown as chips in its header. */
const columnChips = (col: ViewCol) => groupsForColumn(col.board.columnGroups, col.columnId)

// Columns look as on their board: header colour, outline (column, else board
// default), WIP limit, rules, points and time. Widths and collapsed columns are
// the view's own (personal, localStorage `kanban:custom-view:column-widths:<view>`
// and `kanban:custom-view:collapsed-columns:<view>`); a column without a width of
// its own here takes the one set on its board (`kanban:column-widths:<board>`).
const storedWidths = ref<Record<string, ColumnWidths>>({})
onMounted(() => watch(boardIds, (ids) => {
  try { storedWidths.value = Object.fromEntries(ids.map(b => [b, parseColumnWidths(localStorage.getItem(columnWidthsKey(b)))])) }
  catch { /* storage unavailable */ }
}, { immediate: true }))
const viewColumnIds = computed(() => view.value?.columns.map(c => c.columnId) ?? [])
const columnBoard = computed(() => new Map(view.value?.columns.map(c => [c.columnId, c.boardId]) ?? []))
const columnWidths = useColumnWidths(id, viewColumnIds, {
  key: `kanban:custom-view:column-widths:${id}`,
  fallback: columnId => storedWidths.value[columnBoard.value.get(columnId) ?? '']?.[columnId],
})
const collapsedColumns = useCollapsedColumns(id, viewColumnIds, { key: `kanban:custom-view:collapsed-columns:${id}` })

// Column controls as on the board, for editors (owner/editor, not limited,
// archived or offline; the server decides). Menu choices go to that board's
// ViewColumnTools, mounted on first use and kept, which loads the board with
// useBoard and opens the board's own dialogs.
const canEditBoard = (board: BoardDetail) =>
  !offline.value && !board.archivedAt && (board.role === 'owner' || board.role === 'editor') && !board.myAccess
const toolRequests = ref<Record<string, ViewColumnRequest & { n: number }>>({})
let requestCount = 0
function requestTool(boardId: string, req: ViewColumnRequest) {
  toolRequests.value = { ...toolRequests.value, [boardId]: { ...req, n: ++requestCount } }
}
function toolsGone(boardId: string) {
  const { [boardId]: _, ...rest } = toolRequests.value
  toolRequests.value = rest
  loadBoard(boardId)
}
function columnMenu(col: ViewCol) {
  const b = col.boardId
  const columnId = col.columnId
  return [[
    { label: t('board.column.edit'), icon: 'i-lucide-pencil', onSelect: () => requestTool(b, { kind: 'edit', columnId }) },
    { label: t('board.column.colour'), icon: 'i-lucide-palette', onSelect: () => requestTool(b, { kind: 'colour', columnId }) },
    { label: t('board.column.rules'), icon: 'i-lucide-zap', onSelect: () => requestTool(b, { kind: 'rules', columnId }) },
    { label: t('board.column.automations'), icon: 'i-lucide-timer', onSelect: () => requestTool(b, { kind: 'automations', columnId }) },
    { label: t('board.column.sortPriority'), icon: 'i-lucide-arrow-down-wide-narrow', disabled: col.cards.length < 2, onSelect: () => requestTool(b, { kind: 'sort', columnId }) },
    {
      label: t('columnGroups.menu'),
      icon: 'i-lucide-columns-3',
      children: [
        col.board.columnGroups.map(g => ({
          label: g.name,
          type: 'checkbox' as const,
          checked: g.columnIds.includes(columnId),
          onUpdateChecked: (member: boolean) => requestTool(b, { kind: 'group', columnId, groupId: g.id, member }),
          onSelect: (e: Event) => e.preventDefault(),
        })),
        [{ label: t('columnGroups.manage'), icon: 'i-lucide-settings-2', onSelect: () => requestTool(b, { kind: 'groups' }) }],
      ].filter(items => items.length),
    },
    { label: t('common.delete'), icon: 'i-lucide-trash', color: 'error' as const, onSelect: async () => {
      if (await confirm({ title: t('board.column.deleteConfirm', { title: col.title }), confirmLabel: t('common.delete') })) requestTool(b, { kind: 'delete', columnId })
    } },
  ]]
}

// Inline column rename: double-click the title, Enter or blur saves, Escape cancels.
const renamingColumnId = ref<string | null>(null)
const columnTitleDraft = ref('')
function startColumnRename(col: ViewCol) {
  if (!canEditBoard(col.board)) return
  columnTitleDraft.value = col.title
  renamingColumnId.value = col.columnId
}
function finishColumnRename(col: ViewCol, save: boolean) {
  if (renamingColumnId.value !== col.columnId) return
  renamingColumnId.value = null
  const title = columnTitleDraft.value.trim()
  if (save && title && title !== col.title) {
    col.column.title = title
    requestTool(col.boardId, { kind: 'rename', columnId: col.columnId, title })
  }
}
function focusRenameInput(el: unknown) {
  if (el instanceof HTMLInputElement && document.activeElement !== el) {
    el.focus()
    el.select()
  }
}
function wipState(col: ViewCol) {
  const limit = col.column.wipLimit
  if (!limit) return null
  return col.cards.length > limit ? 'over' : col.cards.length === limit ? 'full' : 'ok'
}
function columnStyle(col: ViewCol) {
  const size = collapsedColumns.isCollapsed(col.columnId) ? { width: `${COLLAPSED_COLUMN_WIDTH}px` } : columnWidths.styleOf(col.columnId)
  return [size, columnOutlineStyle(outlineOf(col), wipState(col) === 'over', col.color) ?? {}]
}
function columnPoints(col: ViewCol) {
  const estimates = col.cards.filter(c => c.estimate !== null).map(c => c.estimate!)
  return estimates.length ? Number(estimates.reduce((a, b) => a + b, 0).toFixed(2)) : null
}
const columnTime = (col: ViewCol) => col.cards.reduce((sum, c) => sum + c.timeMinutes, 0)
// Views like the board page (?view=, board when absent; the last one per custom
// view kept in localStorage). List, calendar and timeline take the view's columns
// of every board as one set; ids are unique across boards, so tags, fields and
// people merge into one list. Read-only like the board view here: cards open in
// their board's dialog.
type ViewKind = 'board' | 'list' | 'calendar' | 'timeline'
const viewKinds: ViewKind[] = ['board', 'list', 'calendar', 'timeline']
const viewIcons: Record<ViewKind, string> = { board: 'i-lucide-square-kanban', list: 'i-lucide-list', calendar: 'i-lucide-calendar-days', timeline: 'i-lucide-gantt-chart' }
const viewItems = computed(() => viewKinds.map(v => ({ label: t(`board.views.${v}`), value: v, icon: viewIcons[v] })))
const isViewKind = (v: unknown): v is ViewKind => viewKinds.includes(v as ViewKind)
const viewKindKey = `kanban:custom-view:view:${id}`
const viewKind = computed<ViewKind>({
  get: () => isViewKind(route.query.view) ? route.query.view : 'board',
  set: (v) => {
    localStorage.setItem(viewKindKey, v)
    navigateTo({ query: { ...route.query, view: v === 'board' ? undefined : v } }, { replace: true })
  },
})
onMounted(() => {
  const stored = localStorage.getItem(viewKindKey)
  if (route.query.view === undefined && isViewKind(stored) && stored !== 'board') viewKind.value = stored
})
// With columns of several boards, column names carry their board's name.
const severalBoards = computed(() => new Set(columns.value.map(c => c.boardId)).size > 1)
const mergedColumns = computed<Column[]>(() => columns.value.flatMap((c) => {
  const column = c.board.columns.find(bc => bc.id === c.columnId)
  if (!column) return []
  return [severalBoards.value ? { ...column, title: `${c.board.name} › ${column.title}` } : column]
}))
const mergedCards = computed(() => columns.value.flatMap(c => c.cards))
const viewBoards = computed(() => [...new Map(columns.value.map(c => [c.boardId, c.board])).values()])
const mergedTags = computed(() => viewBoards.value.flatMap(b => b.tags))
const mergedFields = computed(() => viewBoards.value.flatMap(b => b.fields))
const mergedMembers = computed(() => [...new Map(viewBoards.value.flatMap(b => b.members).map((m): [string, Member] => [m.userId, m])).values()])
const cardBoard = computed(() => new Map(columns.value.flatMap(c => c.cards.map(card => [card.id, c.boardId] as const))))
function openById(cardId: string) {
  const boardId = cardBoard.value.get(cardId)
  if (boardId) openCard.value = { boardId, cardId }
}
const noSelection = new Set<string>()

// New cards: like the board page, in columns the person may edit (owner/editor,
// member limits, not archived, online). The server decides (RLS).
const offline = useOffline()
const canAddTo = (board: BoardDetail, columnId: string) =>
  !offline.value && !board.archivedAt && (board.role === 'owner' || board.role === 'editor')
  && columnAccess(board.myAccess, board.role, columnId) === 'edit'
async function addCard(boardId: string, columnId: string, title: string, openIt: boolean) {
  try {
    // Column rules run on the server; the reload shows their result.
    const card = await api<Card>(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId, title } })
    await loadBoard(boardId)
    if (openIt) open(boardId, card)
  }
  catch (err) { showError(err, t('board.errors.addCard')) }
}

// Card actions as on the board, for cards the person may edit (same checks as
// useBoard.canEditCard). The server decides (RLS); a failure reloads the board.
const canEditCard = (board: BoardDetail, card: Card) =>
  !offline.value && !board.archivedAt && (board.role === 'owner' || board.role === 'editor')
  && cardAccess(board.myAccess, board.role, card) === 'edit'

// Undo through a toast, like the board page (no keyboard shortcut here).
let undoToastId: string | number | undefined
const undoStack = useUndo({
  limit: 20,
  onPush: (entry) => {
    if (undoToastId !== undefined) toast.remove(undoToastId)
    undoToastId = toast.add({
      title: entry.label,
      duration: 6000,
      actions: [{ label: t('board.undo.action'), icon: 'i-lucide-undo-2', color: 'neutral', variant: 'outline', onClick: () => { undoStack.undo() } }],
    }).id
  },
  onError: (err) => {
    console.warn(err)
    toast.add({ title: t('board.undo.undoFailed'), description: t('board.undo.changed'), color: 'warning' })
    reloadAll()
  },
})
function reloadAll() {
  return Promise.all(Object.keys(boards.value).map(loadBoard))
}
async function cardAction(boardId: string, fn: () => Promise<void>, message: string) {
  try { await fn() }
  catch (err) {
    showError(err, message)
    await loadBoard(boardId)
  }
}
async function patchCard(boardId: string, cardId: string, body: Record<string, unknown>) {
  await api<Card>(`/api/cards/${cardId}`, { method: 'PATCH', body })
  await loadBoard(boardId)
}
function setCompleted(boardId: string, card: Card, completed: boolean) {
  if (!!card.completedAt === completed) return
  return cardAction(boardId, async () => {
    card.completedAt = completed ? new Date().toISOString() : null
    await patchCard(boardId, card.id, { completed })
    undoStack.push({
      label: t(completed ? 'board.undo.completedCard' : 'board.undo.reopenedCard'),
      undo: () => patchCard(boardId, card.id, { completed: !completed }),
      redo: () => patchCard(boardId, card.id, { completed }),
    })
  }, t('board.errors.saveCard'))
}
function rename(boardId: string, card: Card, title: string) {
  const before = card.title
  return cardAction(boardId, async () => {
    card.title = title
    await patchCard(boardId, card.id, { title })
    undoStack.push({
      label: t('board.undo.renamedCard'),
      undo: () => patchCard(boardId, card.id, { title: before }),
      redo: () => patchCard(boardId, card.id, { title }),
    })
  }, t('board.errors.saveCard'))
}
async function trash(boardId: string, cardId: string, trashed: boolean) {
  if (trashed) await api(`/api/cards/${cardId}`, { method: 'DELETE' })
  else await api(`/api/cards/${cardId}/restore`, { method: 'POST' })
  await loadBoard(boardId)
}
function deleteCard(boardId: string, card: Card) {
  return cardAction(boardId, async () => {
    const board = boards.value[boardId]
    if (board) board.cards = board.cards.filter(c => c.id !== card.id)
    await trash(boardId, card.id, true)
    undoStack.push({
      label: t('board.undo.deletedCard'),
      undo: () => trash(boardId, card.id, false),
      redo: () => trash(boardId, card.id, true),
    })
  }, t('board.errors.deleteCard'))
}
function runButton(boardId: string, button: BoardButton, card: Card) {
  return cardAction(boardId, async () => {
    const res = await api<ButtonRunResult>(`/api/buttons/${button.id}/run`, { method: 'POST', body: { cardId: card.id } })
    await loadBoard(boardId)
    toast.add({
      title: t('buttons.ran', { name: button.name }),
      description: res.skipped ? t('buttons.skipped', { n: res.skipped }, res.skipped) : undefined,
      color: res.skipped ? 'warning' : 'success',
    })
  }, t('buttons.errors.run', { name: button.name }))
}

// Blocked / blocking marks need the whole board's cards.
const linkMarks = computed(() => Object.fromEntries(Object.entries(boards.value).map(([b, board]) => [b, {
  blocked: blockedCardIds(board.cards, board.columns),
  blocking: blockingCardIds(board.cards, board.columns),
}])))
const cardButtons = (board: BoardDetail) => board.buttons.filter(b => b.scope === 'card')

const today = ref(isoDate())
let dayTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => { dayTimer = setInterval(() => { today.value = isoDate() }, 60_000) })
onBeforeUnmount(() => clearInterval(dayTimer))

// The open card (its board loads in ViewCardDialog). Closing reloads that board:
// this tab's own changes send it no live event.
const openCard = ref<{ boardId: string, cardId: string } | null>(null)
function open(boardId: string, card: Card) {
  openCard.value = { boardId, cardId: card.id }
}
function closeCard() {
  const boardId = openCard.value?.boardId
  openCard.value = null
  if (boardId) loadBoard(boardId)
}

const editOpen = ref(false)

// Background, accent and outline: saved at once, undoable like on the board (not uploads).
const appearanceOpen = ref(false)
type Appearance = { background?: BoardBackground | null, accent?: BoardAccent | null, columnOutline?: ColumnOutline | null }
async function patchAppearance(body: Appearance) {
  view.value = await $fetch<CustomView>(`/api/views/${id}`, { method: 'PATCH', body })
}
async function setAppearance<K extends keyof Appearance>(key: K, value: Appearance[K], label: string) {
  const before = view.value?.[key] ?? null
  if (JSON.stringify(before) === JSON.stringify(value ?? null)) return
  try {
    await patchAppearance({ [key]: value })
    if ((before as BoardBackground | null)?.kind !== 'upload') {
      undoStack.push({ label, undo: () => patchAppearance({ [key]: before }), redo: () => patchAppearance({ [key]: value }) })
    }
  }
  catch (err) { showError(err, t('customViews.errors.appearance')) }
}
async function uploadBackground(file: File) {
  const form = new FormData()
  form.append('file', file)
  try {
    const res = await $fetch<{ background: BoardBackground }>(`/api/views/${id}/background`, { method: 'POST', body: form })
    if (view.value) view.value.background = res.background
  }
  catch (err) { showError(err, t('board.errors.backgroundUpload')) }
}
async function onSaved(saved: CustomView) {
  view.value = saved
  await Promise.all(boardIds.value.filter(b => !boards.value[b]).map(loadBoard))
}
async function remove() {
  if (!await confirm({ title: t('customViews.deleteConfirm', { name: view.value?.name }), confirmLabel: t('common.delete'), color: 'error' })) return
  try {
    await $fetch<unknown>(`/api/views/${id}`, { method: 'DELETE' as const })
    boardTabs.forget(id)
    await navigateTo('/')
  }
  catch (err) { showError(err, t('customViews.errors.delete')) }
}
// Tag and column tag names: the same personal choice as in the board menu
// (localStorage `kanban:labels`, all boards and views).
const labels = useLabelDisplay()
onMounted(loadLabelDisplay)
const hasColumnGroups = computed(() => columns.value.some(c => columnChips(c).length))
const menu = computed(() => [
  [
    { label: t('customViews.edit'), icon: 'i-lucide-pencil', onSelect: () => { editOpen.value = true } },
    { label: t('customViews.appearance.menu'), icon: 'i-lucide-image', onSelect: () => { appearanceOpen.value = true } },
  ],
  [
    {
      label: t('board.menu.tagNames'),
      icon: 'i-lucide-tag',
      type: 'checkbox' as const,
      checked: labels.value.tagNames,
      onUpdateChecked: (tagNames: boolean) => setLabelDisplay({ tagNames }),
    },
    ...(hasColumnGroups.value
      ? [{
          label: t('board.menu.groupNames'),
          icon: 'i-lucide-columns-3',
          type: 'checkbox' as const,
          checked: labels.value.groupNames,
          onUpdateChecked: (groupNames: boolean) => setLabelDisplay({ groupNames }),
        }]
      : []),
  ],
  [
    { label: t('common.delete'), icon: 'i-lucide-trash', color: 'error' as const, onSelect: remove },
  ],
])
</script>

<template>
  <div v-if="view" class="flex flex-col flex-none min-h-0 h-[calc(100dvh-var(--ui-header-height)-env(safe-area-inset-bottom))]" :style="bgStyle">
    <BoardTabs :active-id="id" :class="backed && 'bg-default/85 backdrop-blur-sm'" />
    <div class="flex flex-wrap items-center gap-3 px-4 py-3" :class="backed && 'bg-default/85 backdrop-blur-sm'">
      <UIcon name="i-lucide-columns-3" class="size-5 text-muted" />
      <h1 class="text-xl font-semibold truncate">
        {{ view.name }}
      </h1>
      <div class="ms-auto flex items-center gap-2">
        <UTabs v-model="viewKind" :items="viewItems" :content="false" size="sm" class="hidden sm:flex" :aria-label="t('board.viewLabel')" />
        <USelect
          v-model="viewKind"
          :items="viewItems"
          :icon="viewIcons[viewKind]"
          class="sm:hidden shrink-0"
          :ui="{ base: 'h-8 w-8 p-0', leading: 'inset-0 p-0 justify-center', value: 'sr-only', placeholder: 'sr-only', trailing: 'hidden', content: 'min-w-48' }"
          :aria-label="t('board.viewLabel')"
        />
        <UButton color="neutral" variant="outline" icon="i-lucide-columns-3-cog" :aria-label="t('customViews.edit')" @click="editOpen = true">
          <span class="hidden sm:inline">{{ t('customViews.editColumns') }}</span>
        </UButton>
        <UDropdownMenu :items="menu">
          <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" :aria-label="t('customViews.actions')" />
        </UDropdownMenu>
      </div>
    </div>

    <UEmpty
      v-if="!columns.length"
      icon="i-lucide-columns-3"
      :title="t('customViews.emptyTitle')"
      :description="view.columns.length ? t('customViews.unavailable') : t('customViews.emptyDescription')"
      :actions="[{ label: t('customViews.editColumns'), icon: 'i-lucide-columns-3-cog', onClick: () => { editOpen = true } }]"
      class="m-4"
      :class="panel"
    />
    <div v-else-if="viewKind === 'list'" class="flex-1 min-h-0 overflow-auto px-4 pb-4" data-testid="view-list">
      <BoardListView
        :class="panel"
        :cards="mergedCards"
        :columns="mergedColumns"
        :members="mergedMembers"
        :tags="mergedTags"
        :fields="mergedFields"
        :can-edit="false"
        :today="today"
        :selected-ids="noSelection"
        @open="openById"
      />
    </div>
    <div v-else-if="viewKind === 'calendar'" class="flex-1 min-h-0 overflow-auto px-4 pb-4" data-testid="view-calendar">
      <BoardCalendarView :class="panel" :cards="mergedCards" :tags="mergedTags" :can-edit="false" :today="today" @open="openById" />
    </div>
    <div v-else-if="viewKind === 'timeline'" class="flex-1 min-h-0 overflow-auto px-4 pb-4" data-testid="view-timeline">
      <BoardTimelineView :class="panel" :cards="mergedCards" :columns="mergedColumns" :today="today" @open="openById" />
    </div>
    <div v-else class="flex flex-1 min-h-0 items-start gap-3 overflow-x-auto px-4 pb-4 snap-x sm:snap-none" :class="backed && 'pt-4'" data-testid="view-columns">
      <section
        v-for="col in columns"
        :key="col.columnId"
        class="group/col relative flex shrink-0 snap-start flex-col rounded-lg max-h-full"
        :class="[!outlineOf(col) && ['ring', wipState(col) === 'over' ? 'ring-error' : 'ring-default'], backed ? 'bg-elevated/95 shadow-lg' : 'bg-elevated/60']"
        :style="columnStyle(col)"
        :data-column-id="col.columnId"
      >
        <!-- Collapsed: a narrow strip with the title and card count; click expands. -->
        <button
          v-if="collapsedColumns.isCollapsed(col.columnId)"
          type="button"
          class="flex flex-col items-center gap-2 py-2 min-h-40 rounded-lg cursor-pointer hover:bg-accented/40 focus-visible:outline-2 focus-visible:outline-primary"
          :style="col.color ? { backgroundColor: col.color, color: contrastText(col.color) } : undefined"
          :aria-label="t('board.column.expand', { title: col.title, count: col.cards.length })"
          :title="t('board.column.expand', { title: col.title, count: col.cards.length })"
          data-testid="collapsed-column"
          @click="collapsedColumns.setCollapsed(col.columnId, false)"
        >
          <UIcon name="i-lucide-unfold-horizontal" class="size-4 shrink-0" :class="!col.color && 'text-dimmed'" />
          <UBadge
            :color="wipState(col) === 'over' ? 'error' : wipState(col) === 'full' ? 'warning' : 'neutral'"
            :variant="wipState(col) === 'over' ? 'solid' : 'soft'"
            size="sm"
            :label="col.column.wipLimit ? `${col.cards.length}/${col.column.wipLimit}` : String(col.cards.length)"
          />
          <span class="font-medium [writing-mode:vertical-rl] whitespace-nowrap overflow-hidden text-ellipsis max-h-[calc(100dvh-20rem)]">{{ col.title }}</span>
        </button>
        <template v-else>
          <UTooltip :content="{ side: 'right' }" :text="t('board.column.resizeHint')">
            <div
              role="separator"
              aria-orientation="vertical"
              tabindex="0"
              :aria-label="t('board.column.resize')"
              :aria-valuenow="columnWidths.widthOf(col.columnId)"
              :aria-valuemin="COLUMN_WIDTH_MIN"
              :aria-valuemax="COLUMN_WIDTH_MAX"
              class="absolute inset-y-0 -right-2.5 z-10 w-3 cursor-col-resize touch-none group/resize flex justify-center focus:outline-none"
              @pointerdown="columnWidths.startResize(col.columnId, $event)"
              @dblclick="columnWidths.resetWidth(col.columnId)"
              @keydown="columnWidths.onResizeKey(col.columnId, $event)"
            >
              <span
                class="w-0.5 h-full rounded-full transition-colors group-hover/resize:bg-primary group-focus-visible/resize:bg-primary"
                :class="columnWidths.resizing.value === col.columnId ? 'bg-primary' : 'bg-transparent'"
              />
            </div>
          </UTooltip>
          <header
            class="@container flex flex-col gap-1.5 px-3 py-2 rounded-t-lg"
            :style="col.color ? { backgroundColor: col.color, color: contrastText(col.color) } : undefined"
          >
            <div class="flex items-start gap-2">
              <input
                v-if="renamingColumnId === col.columnId"
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
                class="min-w-0 flex-1 font-medium leading-6 wrap-break-word"
                :class="canEditBoard(col.board) && 'cursor-text select-none'"
                @dblclick="startColumnRename(col)"
              >
                {{ col.title }}
              </h2>
              <div class="flex items-center gap-0.5 shrink-0 min-h-6">
                <UTooltip v-if="col.column.wipLimit" :text="wipState(col) === 'over' ? t('board.column.overWip', { limit: col.column.wipLimit }) : t('board.column.wip', { limit: col.column.wipLimit })">
                  <UBadge
                    :color="wipState(col) === 'over' ? 'error' : wipState(col) === 'full' ? 'warning' : 'neutral'"
                    :variant="wipState(col) === 'over' ? 'solid' : 'soft'"
                    size="sm"
                    :label="`${col.cards.length}/${col.column.wipLimit}`"
                  />
                </UTooltip>
                <UBadge v-else color="neutral" variant="soft" size="sm" :label="String(col.cards.length)" />
                <UTooltip :text="t('board.column.collapse')">
                  <UButton
                    icon="i-lucide-fold-horizontal"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :class="[collapseButtonClass, col.color && 'text-inherit hover:bg-black/10']"
                    :aria-label="t('board.column.collapse')"
                    @click="collapsedColumns.setCollapsed(col.columnId, true)"
                  />
                </UTooltip>
                <UDropdownMenu v-if="canEditBoard(col.board)" :items="columnMenu(col)">
                  <UButton icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" class="pointer-coarse:p-1.5" :aria-label="t('board.column.actions')" :class="col.color && 'text-inherit hover:bg-black/10'" />
                </UDropdownMenu>
              </div>
            </div>
            <ULink :to="`/boards/${col.boardId}`" raw class="-mt-1 text-xs hover:underline truncate block" :class="!col.color && 'text-muted'">
              {{ col.board.name }}
            </ULink>
            <div
              v-if="col.column.rules.length || columnPoints(col) !== null || columnTime(col)"
              class="flex flex-wrap items-center gap-x-2.5 gap-y-1 -mt-1"
              :class="col.color ? 'opacity-80' : 'text-muted'"
            >
              <UTooltip v-if="col.column.rules.length" :text="t('board.column.ruleCount', { count: col.column.rules.length }, col.column.rules.length)">
                <span class="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums">
                  <UIcon name="i-lucide-zap" class="size-3.5 shrink-0" />{{ col.column.rules.length }}
                </span>
              </UTooltip>
              <UTooltip v-if="columnPoints(col) !== null" :text="formatPoints(columnPoints(col)!, i18n)">
                <span class="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums">
                  <UIcon name="i-lucide-sigma" class="size-3.5 shrink-0" />{{ columnPoints(col) }}
                </span>
              </UTooltip>
              <UTooltip v-if="columnTime(col)" :text="t('board.column.timeLogged', { time: formatDuration(columnTime(col), t) })">
                <span class="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums">
                  <UIcon name="i-lucide-timer" class="size-3.5 shrink-0" />{{ formatDuration(columnTime(col), t) }}
                </span>
              </UTooltip>
            </div>
            <!-- Column tag chips as on the board (no group picker here, so they only show). -->
            <div
              v-if="columnChips(col).length"
              class="flex flex-wrap items-center gap-1"
              :class="col.color ? '-mx-1.5 px-1.5 py-1.5 rounded-md bg-default/60' : 'border-t border-current/15 pt-1.5'"
            >
              <UTooltip v-for="g in columnChips(col)" :key="g.id" :disabled="labels.groupNames" :text="g.name">
                <span
                  class="rounded ring ring-inset ring-black/10"
                  :style="g.color ? { backgroundColor: g.color, color: contrastText(g.color) } : undefined"
                  :class="[!g.color && 'bg-accented text-default', labels.groupNames ? 'inline-flex items-center gap-1 px-1.5 text-xs leading-5' : 'inline-block h-2 w-8 rounded-full']"
                  :aria-label="labels.groupNames ? undefined : g.name"
                >
                  <template v-if="labels.groupNames">
                    <UIcon name="i-lucide-columns-3" class="size-3 shrink-0" />{{ g.name }}
                  </template>
                </span>
              </UTooltip>
            </div>
          </header>
          <div class="flex flex-col gap-2 min-h-8 overflow-y-auto px-3 py-2">
            <BoardCard
              v-for="card in col.cards"
              :key="card.id"
              :data-card-id="card.id"
              :card="card"
              :tags="col.board.tags"
              :fields="col.board.fields"
              :members="col.board.members"
              :can-edit="canEditCard(col.board, card)"
              :selectable="false"
              :today="today"
              :blocked="linkMarks[col.boardId]?.blocked.has(card.id)"
              :blocking="linkMarks[col.boardId]?.blocking.has(card.id)"
              :buttons="cardButtons(col.board)"
              :button-align="col.board.buttonAlign"
              @open="open(col.boardId, card)"
              @complete="value => setCompleted(col.boardId, card, value)"
              @rename="title => rename(col.boardId, card, title)"
              @delete="deleteCard(col.boardId, card)"
              @run-button="b => runButton(col.boardId, b, card)"
            />
            <p v-if="!col.cards.length" class="px-1 text-sm text-muted">
              {{ t('customViews.noCards') }}
            </p>
          </div>
          <div v-if="canAddTo(col.board, col.columnId)" class="px-3 pb-2">
            <InlineAdd :label="t('board.addCard')" :placeholder="t('board.cardTitle')" :maxlength="CARD_TITLE_MAX" openable @add="(title, openIt) => addCard(col.boardId, col.columnId, title, openIt)" />
          </div>
        </template>
      </section>
    </div>

    <CustomViewModal v-model:open="editOpen" :view="view" @saved="onSaved" />
    <BoardBackgroundModal
      v-model:open="appearanceOpen"
      :owner="{ viewId: id }"
      :background="view.background"
      :accent="view.accent"
      :column-outline="view.columnOutline"
      :upload="uploadBackground"
      @set="bg => setAppearance('background', bg, t('board.undo.changedBackground'))"
      @set-accent="a => setAppearance('accent', a, t('board.undo.changedAccent'))"
      @set-column-outline="o => setAppearance('columnOutline', o, t('board.undo.changedColumnOutline'))"
    />
    <Suspense v-for="(req, b) in toolRequests" :key="b">
      <ViewColumnTools :board-id="String(b)" :request="req" @changed="loadBoard(String(b))" @gone="toolsGone(String(b))" />
    </Suspense>
    <Suspense v-if="openCard">
      <ViewCardDialog :key="`${openCard.boardId}:${openCard.cardId}`" :board-id="openCard.boardId" :card-id="openCard.cardId" @close="closeCard" />
    </Suspense>
  </div>
</template>
