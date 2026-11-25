<script setup lang="ts">
import type { BoardDetail, Card, Column, Member } from '#shared/types/board'
import type { BoardButton, ButtonRunResult } from '#shared/buttons'
import type { CustomView } from '#shared/types/customViews'
import { CARD_TITLE_MAX } from '#shared/cards'

// A custom view: the person's chosen columns from several boards side by side.
// Each board loads through GET /api/boards/:id (RLS decides what shows); cards
// look and act as on the board (complete, rename, delete, card buttons) and open
// in the full card dialog of their board, but are not dragged here.
const route = useRoute()
const { t } = useI18n()
const confirm = useConfirm()
const showError = useApiError()
const toast = useToast()
const requestFetch = useRequestFetch()
const id = route.params.id as string

const { data: view, error, refresh: refreshView } = await useFetch<CustomView>(`/api/views/${id}`)
if (error.value) throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: t('customViews.notFound'), fatal: true })
useHead({ title: () => view.value?.name ?? t('customViews.title') })

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
await useAsyncData(`view-boards-${id}`, async () => {
  const loaded = await Promise.all(boardIds.value.map(async b => [b, await fetchBoard(b)] as const))
  boards.value = Object.fromEntries(loaded.filter((e): e is [string, BoardDetail] => !!e[1]))
  return true
})

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
  return [{ ...vc, title: column.title, color: column.color, board, cards: board.cards.filter(c => c.columnId === column.id) }]
}))
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
async function onSaved(saved: CustomView) {
  view.value = saved
  await Promise.all(boardIds.value.filter(b => !boards.value[b]).map(loadBoard))
}
async function remove() {
  if (!await confirm({ title: t('customViews.deleteConfirm', { name: view.value?.name }), confirmLabel: t('common.delete'), color: 'error' })) return
  try {
    await $fetch<unknown>(`/api/views/${id}`, { method: 'DELETE' as const })
    await navigateTo('/')
  }
  catch (err) { showError(err, t('customViews.errors.delete')) }
}
const menu = computed(() => [[
  { label: t('customViews.edit'), icon: 'i-lucide-pencil', onSelect: () => { editOpen.value = true } },
  { label: t('common.delete'), icon: 'i-lucide-trash', color: 'error' as const, onSelect: remove },
]])
</script>

<template>
  <div v-if="view" class="flex flex-col flex-none min-h-0 h-[calc(100dvh-var(--ui-header-height)-env(safe-area-inset-bottom))]">
    <div class="flex flex-wrap items-center gap-3 px-4 py-3">
      <UIcon name="i-lucide-columns-3" class="size-5 text-muted" />
      <h1 class="text-xl font-semibold truncate">
        {{ view.name }}
      </h1>
      <span v-if="viewKind === 'board'" class="text-sm text-muted">{{ t('customViews.readOnlyHint') }}</span>
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
    />
    <div v-else-if="viewKind === 'list'" class="flex-1 min-h-0 overflow-auto px-4 pb-4" data-testid="view-list">
      <BoardListView
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
      <BoardCalendarView :cards="mergedCards" :tags="mergedTags" :can-edit="false" :today="today" @open="openById" />
    </div>
    <div v-else-if="viewKind === 'timeline'" class="flex-1 min-h-0 overflow-auto px-4 pb-4" data-testid="view-timeline">
      <BoardTimelineView :cards="mergedCards" :columns="mergedColumns" :today="today" @open="openById" />
    </div>
    <div v-else class="flex flex-1 min-h-0 gap-3 overflow-x-auto px-4 pb-4 snap-x sm:snap-none" data-testid="view-columns">
      <section
        v-for="col in columns"
        :key="col.columnId"
        class="flex w-72 max-w-[calc(100vw-3rem)] shrink-0 snap-start flex-col rounded-lg bg-elevated/50 ring ring-default"
        :data-column-id="col.columnId"
      >
        <header class="px-3 pt-2 pb-1">
          <div class="flex items-center gap-2">
            <span v-if="col.color" class="size-2.5 shrink-0 rounded-full" :style="{ background: col.color }" />
            <h2 class="font-semibold truncate" :style="col.color ? { color: col.color } : undefined">
              {{ col.title }}
            </h2>
            <UBadge color="neutral" variant="subtle" size="sm" :label="String(col.cards.length)" class="ms-auto" />
          </div>
          <ULink :to="`/boards/${col.boardId}`" class="text-xs text-muted hover:underline truncate block">
            {{ col.board.name }}
          </ULink>
        </header>
        <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-2">
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
          <p v-if="!col.cards.length" class="px-1 py-2 text-sm text-muted">
            {{ t('customViews.noCards') }}
          </p>
        </div>
        <div v-if="canAddTo(col.board, col.columnId)" class="px-2 pb-2">
          <InlineAdd :label="t('board.addCard')" :placeholder="t('board.cardTitle')" :maxlength="CARD_TITLE_MAX" openable @add="(title, openIt) => addCard(col.boardId, col.columnId, title, openIt)" />
        </div>
      </section>
    </div>

    <CustomViewModal v-model:open="editOpen" :view="view" @saved="onSaved" />
    <Suspense v-if="openCard">
      <ViewCardDialog :key="`${openCard.boardId}:${openCard.cardId}`" :board-id="openCard.boardId" :card-id="openCard.cardId" @close="closeCard" />
    </Suspense>
  </div>
</template>
