import type { BoardAccent } from '#shared/boardAccents'
import type { ColumnOutline } from '#shared/columnOutline'
import type { BoardBackground } from '#shared/boardBackgrounds'
import type { AssigneeGroup, BoardAutomation, BoardDetail, BoardRule, NewBoardRule, BoardField, BulkCardAction, Card, CardLink, CardPatch, CardRecurrence, Column, ColumnGroup, ColumnRule, FieldValue, NewBoardAutomation, NewColumnRule, NewScheduledCardAction, ScheduledCardAction, NewColumnRuleRequest, RecurrenceInput, SavedView, Tag } from '#shared/types/board'
import type { SavedViewConfig } from '#shared/savedViews'
import type { BoardButton, ButtonRunResult } from '#shared/buttons'

/** Card fields kept in step with the card dialog's details. */
export type CardCounts = Pick<Card, 'checklist' | 'commentCount' | 'attachmentCount' | 'timeMinutes' | 'coverAttachmentId' | 'watching'>

export type NewBoardField = Pick<BoardField, 'name' | 'kind' | 'options' | 'showOnCard'>

/** Where a card sits: its column and the neighbours above and below (null = start / end). */
interface Placement { columnId: string, aboveId: string | null, belowId: string | null }

/** Lets the card dialog (useCardDetail) record undo entries on the board's stack. */
export interface BoardUndo {
  record: (label: string, undo: () => Promise<void>, redo?: () => Promise<void>) => void
  refresh: () => Promise<void>
}
export const boardUndoKey: InjectionKey<BoardUndo> = Symbol('boardUndo')

/** Undo labels (board.undo.* keys) per edited card property. */
const cardEditLabels: Record<string, string> = {
  title: 'renamedCard',
  description: 'editedDescription',
  priority: 'changedPriority',
  startDate: 'changedDates',
  dueDate: 'changedDates',
  estimate: 'changedEstimate',
  tagIds: 'changedTags',
  assigneeIds: 'changedAssignees',
  coverAttachmentId: 'changedCover',
}
function cardEditLabel(keys: string[]) {
  const labels = new Set(keys.map(k => cardEditLabels[k] ?? 'editedCard'))
  return `board.undo.${labels.size === 1 ? [...labels][0]! : 'editedCard'}`
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Thrown by an undo whose card or column is gone (logged only; the toast says the board changed). */
function gone(what: string): never {
  throw new Error(`The ${what} is no longer on the board`)
}

/**
 * Board state plus mutations. Mutations are optimistic; on failure the board reloads.
 * Changes by other people arrive as server-sent events and reload the board,
 * deferred while a drag or a mutation is in progress so they do not undo it.
 */
export async function useBoard(id: string) {
  const showError = useApiError()
  const toast = useToast()
  const { t } = useI18n()
  const boardTabs = useBoardTabs()

  // Undo stack of this tab's changes (a new one per board page). Undo reapplies
  // the old state through the API, so it fails cleanly when the target is gone.
  let undoToastId: string | number | undefined
  let stepping: 'undo' | 'redo' = 'undo'
  const undoStack = useUndo({
    limit: 20,
    onPush: (entry) => {
      dismissUndoToast()
      undoToastId = toast.add({
        title: entry.label,
        duration: 6000,
        actions: [{ label: t('board.undo.action'), icon: 'i-lucide-undo-2', color: 'neutral', variant: 'outline', onClick: () => { undo() } }],
      }).id
    },
    onError: (err) => {
      console.warn(err)
      toast.add({ title: t(stepping === 'undo' ? 'board.undo.undoFailed' : 'board.undo.redoFailed'), description: t('board.undo.changed'), color: 'warning' })
      refresh()
    },
  })
  function dismissUndoToast() {
    if (undoToastId !== undefined) toast.remove(undoToastId)
    undoToastId = undefined
  }
  async function step(action: 'undo' | 'redo') {
    dismissUndoToast()
    stepping = action
    busy++
    try { return await undoStack[action]() }
    finally {
      busy--
      catchUp()
    }
  }
  const undo = () => step('undo')
  const redo = () => step('redo')
  const record = (label: string, undo: () => Promise<void>, redo?: () => Promise<void>) => undoStack.push({ label, undo, redo })
  provide(boardUndoKey, { record, refresh: () => refresh() })
  // Bot members, so names across the board (comments, activity, pickers) get a Bot badge. Lazy like below.
  provide(boardBotIdsKey, computed(() => new Set((board.value?.members ?? []).filter(m => m.isBot).map(m => m.userId))))
  // Colours in use, offered as quick picks by the colour pickers. Lazy: the refs below exist by the time it is read.
  provide(boardColorsKey, computed(() => ({
    tags: tags.value,
    columns: columns.value,
    columnGroups: columnGroups.value,
    fields: fields.value,
    columnOutline: board.value?.columnOutline,
    background: board.value?.background,
  })))

  // Registered before the first await, while the component instance is known.
  const offline = useOffline()
  const live = useLiveEvents()
  let unsubscribe: (() => void) | undefined
  function listen() {
    unsubscribe?.()
    // Only for a board that loaded; the server would answer `gone` for any other.
    if (!board.value) return
    unsubscribe = live.subscribeBoard(id, {
      change: () => remoteChanged(),
      gone: () => {
        unsubscribe?.()
        unsubscribe = undefined
        toast.add({ title: t('board.noAccess'), color: 'warning' })
        boardTabs.forget(id)
        navigateTo('/')
      },
      // The stream was down or changed hands (or the device was offline): changes made meanwhile are unknown.
      resync: () => remoteChanged(),
    })
  }
  onMounted(() => listen())
  // Stop as soon as a navigation away starts, not only at unmount, so a late event does not
  // reload or redirect a page being left. A navigation that fails or is cancelled resubscribes.
  let leaving = false
  onBeforeRouteLeave(() => {
    leaving = true
    unsubscribe?.()
    unsubscribe = undefined
  })
  const stopAfterEach = useRouter().afterEach((_to, _from, failure) => {
    if (!leaving || !failure) return
    leaving = false
    listen()
    remoteChanged()
  })
  onBeforeUnmount(() => {
    stopAfterEach()
    unsubscribe?.()
    undoStack.clear()
    dismissUndoToast()
  })

  // deep: mutations write board.value.name, archivedAt, background, starred directly. Watchers on
  // `board` still fire only when a reload replaces the object.
  const { data: board, error, refresh } = await useFetch<BoardDetail>(`/api/boards/${id}`, { deep: true })

  // Archived boards are read-only for everyone (enforced by app.can_edit); owners can unarchive.
  // Offline, the board shows the service worker's cached copy and is read-only too.
  const archived = computed(() => !!board.value?.archivedAt)
  // Limited members (board_member_limits) edit cards per card/column but never the board's
  // structure, so canEdit (columns, tags, rules, ...) is false for them; canEditCard and
  // canAddToColumn decide per card. The server enforces both (RLS).
  const limited = computed(() => !!board.value?.myAccess)
  const writable = computed(() => !archived.value && !offline.value && (board.value?.role === 'owner' || board.value?.role === 'editor'))
  const canEdit = computed(() => writable.value && !limited.value)
  const canEditCard = (card: { id: string, columnId: string }) =>
    writable.value && cardAccess(board.value?.myAccess, board.value?.role, card) === 'edit'
  const canAddToColumn = (columnId: string) =>
    writable.value && columnAccess(board.value?.myAccess, board.value?.role, columnId) === 'edit'
  // Comments and time entries: whoever edits the card, and commenters on cards they can read.
  const canCommentOn = (card: { id: string, columnId: string }) => {
    if (archived.value || offline.value || !board.value?.role) return false
    const access = cardAccess(board.value.myAccess, board.value.role, card)
    return access === 'edit' || (access === 'read' && board.value.role === 'commenter')
  }
  const isOwner = computed(() => !offline.value && board.value?.role === 'owner')

  // Per-column card lists, used as v-model for drag and drop.
  const lists = ref<Record<string, Card[]>>({})
  const columns = ref<Column[]>([])
  const tags = ref<Tag[]>([])
  const fields = ref<BoardField[]>([])
  const columnGroups = ref<ColumnGroup[]>([])
  // Named sets of people (AssigneeGroupsModal); assigning one adds its members.
  const assigneeGroups = ref<AssigneeGroup[]>([])
  const savedViews = ref<SavedView[]>([])
  // Card and board buttons (shared and the user's own).
  const buttons = ref<BoardButton[]>([])
  // Card templates (not on the board) and their recurring schedules.
  const templates = ref<Card[]>([])
  const recurrences = ref<CardRecurrence[]>([])
  // Time-based automations (BoardAutomationsModal).
  const automations = ref<BoardAutomation[]>([])
  // Event-triggered rules (BoardRulesModal).
  const rules = ref<BoardRule[]>([])
  // One-shot actions on cards (card mode of BoardAutomationsModal).
  const scheduledActions = ref<ScheduledCardAction[]>([])
  watch(board, (b) => {
    if (!b) return
    columns.value = [...b.columns]
    tags.value = [...b.tags]
    fields.value = [...b.fields]
    columnGroups.value = b.columnGroups.map(g => ({ ...g, columnIds: [...g.columnIds] }))
    assigneeGroups.value = b.assigneeGroups.map(g => ({ ...g, userIds: [...g.userIds] }))
    savedViews.value = [...b.savedViews]
    buttons.value = [...b.buttons]
    templates.value = [...b.templates]
    recurrences.value = [...b.recurrences]
    automations.value = [...b.automations]
    rules.value = [...b.rules]
    scheduledActions.value = [...b.scheduledActions]
    lists.value = Object.fromEntries(b.columns.map(c => [c.id, b.cards.filter(card => card.columnId === c.id)]))
  }, { immediate: true })

  /** Bumped after each reload caused by someone else, so open dialogs can refetch too. */
  const remoteVersion = ref(0)
  const dragging = ref(false)
  let busy = 0
  let stale = false

  async function remoteChanged() {
    if (busy || dragging.value) {
      stale = true
      return
    }
    stale = false
    await refresh()
    if (error.value?.statusCode === 404) {
      toast.add({ title: t('board.goneOrNoAccess'), color: 'warning' })
      boardTabs.forget(id)
      await navigateTo('/')
      return
    }
    remoteVersion.value++
  }

  function catchUp() {
    if (stale && !busy && !dragging.value) remoteChanged()
  }
  watch(dragging, catchUp)

  // Order of cards and columns when a drag starts, so the move can be undone.
  let dragStart: { cards: Record<string, string[]>, columns: string[] } | undefined
  watch(dragging, (v) => {
    if (v) dragStart = { cards: listIds(), columns: columns.value.map(c => c.id) }
  }, { flush: 'sync' })

  async function run<T>(fn: () => Promise<T>, title: string): Promise<T | undefined> {
    busy++
    try { return await fn() }
    catch (err) {
      showError(err, title)
      await refresh()
    }
    finally {
      busy--
      catchUp()
    }
  }

  /** Drops values of `fieldId` that `drop` matches from every card (all when omitted). */
  function clearFieldValues(fieldId: string, drop: (v: FieldValue) => boolean = () => true) {
    for (const list of Object.values(lists.value)) {
      for (const card of list) {
        const v = card.fields[fieldId]
        if (v !== undefined && drop(v)) delete card.fields[fieldId]
      }
    }
  }

  function removeCard(card: Card) {
    lists.value[card.columnId] = lists.value[card.columnId]!.filter(c => c.id !== card.id)
  }

  const findCard = (cardId: string) => Object.values(lists.value).flat().find(c => c.id === cardId) ?? gone('card')
  const findColumn = (columnId: string) => columns.value.find(c => c.id === columnId) ?? gone('column')
  // Template edits are not undoable (templates are not on the board).
  const isTemplate = (card: Card) => templates.value.some(t => t.id === card.id)
  const listIds = () => Object.fromEntries(Object.entries(lists.value).map(([col, list]) => [col, list.map(c => c.id)]))

  /** Where `id` sits in `order` (column id → ids), or undefined when it is not there. */
  function placementIn(order: Record<string, string[]>, id: string): Placement | undefined {
    for (const [columnId, ids] of Object.entries(order)) {
      const i = ids.indexOf(id)
      if (i >= 0) return { columnId, aboveId: ids[i - 1] ?? null, belowId: ids[i + 1] ?? null }
    }
  }

  /** Index to insert at so the item lands after `aboveId` (or before `belowId`) when they still exist; else start / end. */
  function insertIndex(ids: string[], aboveId: string | null, belowId: string | null) {
    if (aboveId === null) return 0
    const above = ids.indexOf(aboveId)
    if (above >= 0) return above + 1
    const below = belowId ? ids.indexOf(belowId) : -1
    return below >= 0 ? below : ids.length
  }

  /** Persists the card at `index` of `columnId` (already placed locally). */
  async function persistMove(columnId: string, index: number) {
    const list = lists.value[columnId]!
    const card = list[index]!
    card.columnId = columnId
    // The target column's rules may have changed tags, assignees or the due date.
    Object.assign(card, await api<Card>(`/api/cards/${card.id}/move`, {
      method: 'POST',
      body: { columnId, aboveId: list[index - 1]?.id ?? null, belowId: list[index + 1]?.id ?? null },
    }))
    return card
  }

  /** Undo/redo of a move: puts the card back next to the recorded neighbours. */
  async function placeCard(cardId: string, to: Placement) {
    const card = findCard(cardId)
    if (!lists.value[to.columnId]) gone('column')
    removeCard(card)
    const list = lists.value[to.columnId]!
    const at = insertIndex(list.map(c => c.id), to.aboveId, to.belowId)
    list.splice(at, 0, card)
    await persistMove(to.columnId, at)
  }

  /** Persists a card's new place (lists already updated); `from` defaults to its place when the drag started. */
  function cardMoved(columnId: string, index: number, from?: Placement) {
    return run(async () => {
      const cardId = lists.value[columnId]![index]!.id
      from ??= dragStart && placementIn(dragStart.cards, cardId)
      await persistMove(columnId, index)
      const to = placementIn(listIds(), cardId)!
      if (from && !same(from, to)) record(t('board.undo.movedCard'), () => placeCard(cardId, from!), () => placeCard(cardId, to))
    }, t('board.errors.moveCard'))
  }

  /** Undo/redo of a column move. */
  async function placeColumn(columnId: string, aboveId: string | null, belowId: string | null) {
    const col = findColumn(columnId)
    const rest = columns.value.filter(c => c.id !== columnId)
    const at = insertIndex(rest.map(c => c.id), aboveId, belowId)
    rest.splice(at, 0, col)
    columns.value = rest
    await api(`/api/columns/${col.id}`, { method: 'PATCH', body: { aboveId: rest[at - 1]?.id ?? null, belowId: rest[at + 1]?.id ?? null } })
  }

  /** Undo/redo of a column title, colour or WIP limit change. */
  async function patchColumn(columnId: string, patch: Partial<Pick<Column, 'title' | 'color' | 'wipLimit' | 'outline'>>) {
    Object.assign(findColumn(columnId), patch)
    await api(`/api/columns/${columnId}`, { method: 'PATCH', body: patch })
  }

  /** Puts a column's cards in the order of `order` (ids; every card shown in it) and saves it. */
  async function orderColumn(columnId: string, order: string[]) {
    findColumn(columnId)
    const list = lists.value[columnId] ?? gone('column')
    const byId = new Map(list.map(c => [c.id, c]))
    lists.value[columnId] = order.map(cid => byId.get(cid) ?? gone('card'))
    await api(`/api/columns/${columnId}/order`, { method: 'PUT', body: { cardIds: order } })
  }

  /** Applies a column change and records its inverse. */
  function changeColumn<K extends 'title' | 'color' | 'wipLimit'>(col: Column, key: K, value: Column[K], label: string, failure: string) {
    return run(async () => {
      const before = { [key]: col[key] }
      const after = { [key]: value }
      await patchColumn(col.id, after)
      if (!same(before, after)) record(label, () => patchColumn(col.id, before), () => patchColumn(col.id, after))
    }, failure)
  }

  /** Undo/redo of a background change. Uploaded images cannot come back once replaced. */
  async function putBackground(bg: BoardBackground | null) {
    if (bg?.kind === 'upload') throw new Error('The uploaded image is gone')
    board.value!.background = bg
    await (bg
      ? api(`/api/boards/${id}/background`, { method: 'PUT', body: bg })
      : api(`/api/boards/${id}/background`, { method: 'DELETE' }))
  }

  async function putAccent(accent: BoardAccent | null) {
    board.value!.accent = accent
    await api(`/api/boards/${id}/accent`, { method: 'PUT', body: { accent } })
  }

  async function putColumnOutline(outline: ColumnOutline | null) {
    board.value!.columnOutline = outline
    await api(`/api/boards/${id}/column-outline`, { method: 'PUT', body: { outline } })
  }

  /** Undo/redo of a card edit: PATCHes the given values. */
  async function patchCard(cardId: string, patch: CardPatch) {
    const card = findCard(cardId)
    Object.assign(card, patch)
    Object.assign(card, await api<Card>(`/api/cards/${cardId}`, { method: 'PATCH', body: patch }))
  }

  /** Undo/redo of archiving. Unarchiving reloads the board to place the card. */
  /** Moves a card to the trash (dropping it from the board) or brings it back (reloads to place it). */
  async function setCardTrashed(cardId: string, trashed: boolean) {
    if (trashed) {
      removeCard(findCard(cardId))
      await api(`/api/cards/${cardId}`, { method: 'DELETE' })
    }
    else {
      await api(`/api/cards/${cardId}/restore`, { method: 'POST' })
      await refresh()
    }
  }

  async function setCardSnoozed(cardId: string, until: string | null) {
    if (until) removeCard(findCard(cardId))
    await api(`/api/cards/${cardId}`, { method: 'PATCH', body: { snoozedUntil: until } })
    if (!until) await refresh()
  }

  async function setCardArchived(cardId: string, archived: boolean) {
    if (archived) removeCard(findCard(cardId))
    await api(`/api/cards/${cardId}`, { method: 'PATCH', body: { archived } })
    if (!archived) await refresh()
  }

  /**
   * Sends one bulk change and applies the server's copies of the cards: changed
   * in place, moved or restored ones placed by position, archived ones removed.
   */
  async function sendBulk(cardIds: string[], action: BulkCardAction) {
    const res = await api<{ cards: Card[] }>(`/api/boards/${id}/cards/bulk`, { method: 'POST', body: { cardIds, ...action } })
    const updated = new Map(res.cards.map(c => [c.id, c]))
    const touched = new Set<string>()
    for (const [columnId, list] of Object.entries(lists.value)) {
      lists.value[columnId] = list.filter((card) => {
        if (!cardIds.includes(card.id)) return true
        const next = updated.get(card.id)
        if (next?.columnId !== columnId) return false
        Object.assign(card, next)
        updated.delete(card.id)
        return true
      })
    }
    for (const card of updated.values()) {
      if (!lists.value[card.columnId]) continue
      lists.value[card.columnId]!.push(card)
      touched.add(card.columnId)
    }
    for (const columnId of touched) lists.value[columnId]!.sort((a, b) => a.position - b.position)
  }

  async function putFieldValue(cardId: string, fieldId: string, value: FieldValue | null) {
    const card = findCard(cardId)
    if (value === null) delete card.fields[fieldId]
    else card.fields[fieldId] = value
    await api(`/api/cards/${cardId}/fields/${fieldId}`, { method: 'PUT', body: { value } })
  }

  async function patchTag(tagId: string, patch: Partial<Omit<Tag, 'id'>>) {
    const tag = tags.value.find(t => t.id === tagId) ?? gone('tag')
    Object.assign(tag, patch)
    tags.value.sort((a, b) => a.name.localeCompare(b.name))
    await api(`/api/tags/${tagId}`, { method: 'PATCH', body: patch })
  }

  const mutations = {
    renameBoard: (name: string) => run(async () => {
      await api(`/api/boards/${id}`, { method: 'PATCH', body: { name } })
      board.value!.name = name
    }, t('board.errors.renameBoard')),

    /** Archives or unarchives the board (owners). */
    setArchived: (value: boolean) => run(async () => {
      const res = await api<{ archivedAt: string | null }>(`/api/boards/${id}/archive`, { method: value ? 'PUT' : 'DELETE' })
      board.value!.archivedAt = res.archivedAt
    }, t(value ? 'board.errors.archiveBoard' : 'board.errors.unarchiveBoard')),

    /** Sets a preset colour, gradient or photo, or clears the background (owners). */
    setBackground: (bg: BoardBackground | null) => run(async () => {
      const before = board.value!.background
      await putBackground(bg)
      if (!same(before, bg) && before?.kind !== 'upload') {
        record(t('board.undo.changedBackground'), () => putBackground(before), () => putBackground(bg))
      }
    }, t('board.errors.background')),

    /** Sets the board's accent colour, or null for the app default (owners). */
    setAccent: (accent: BoardAccent | null) => run(async () => {
      const before = board.value!.accent
      await putAccent(accent)
      if (before !== accent) record(t('board.undo.changedAccent'), () => putAccent(before), () => putAccent(accent))
    }, t('board.errors.accent')),

    /** Sets the column frame colour, thickness and glow, or null for the default (owners). */
    setColumnOutline: (outline: ColumnOutline | null) => run(async () => {
      const before = board.value!.columnOutline
      await putColumnOutline(outline)
      if (!same(before, outline)) record(t('board.undo.changedColumnOutline'), () => putColumnOutline(before), () => putColumnOutline(outline))
    }, t('board.errors.columnOutline')),

    /** Uploads an image and makes it the background (owners). */
    uploadBackground: (file: File) => run(async () => {
      const form = new FormData()
      form.append('file', file)
      const res = await api<{ background: BoardBackground }>(`/api/boards/${id}/background`, { method: 'POST', body: form })
      board.value!.background = res.background
    }, t('board.errors.backgroundUpload')),

    deleteBoard: () => run(async () => {
      await api(`/api/boards/${id}`, { method: 'DELETE' })
      boardTabs.forget(id)
      await navigateTo('/')
    }, t('board.errors.deleteBoard')),

    /** With groupId, the new column also joins that group (the one the board shows). */
    addColumn: (title: string, groupId?: string | null) => run(async () => {
      const col = await api<Column>(`/api/boards/${id}/columns`, { method: 'POST', body: { title, groupId: groupId ?? undefined } })
      columns.value.push(col)
      lists.value[col.id] = []
      const group = groupId ? columnGroups.value.find(g => g.id === groupId) : undefined
      if (group && !group.columnIds.includes(col.id)) group.columnIds.push(col.id)
    }, t('board.errors.addColumn')),

    renameColumn: (col: Column, title: string) => changeColumn(col, 'title', title, t('board.undo.renamedColumn'), t('board.errors.renameColumn')),

    /** Sets a column's heading colour and outline override together (one undo step). */
    setColumnAppearance: (col: Column, value: Pick<Column, 'color' | 'outline'>) => run(async () => {
      const keys = (['color', 'outline'] as const).filter(k => !same(col[k], value[k]))
      if (!keys.length) return
      const before = Object.fromEntries(keys.map(k => [k, col[k]])) as Partial<Pick<Column, 'color' | 'outline'>>
      const after = Object.fromEntries(keys.map(k => [k, value[k]])) as Partial<Pick<Column, 'color' | 'outline'>>
      await patchColumn(col.id, after)
      const label = keys.includes('color') ? t('board.undo.changedColumnColor') : t('board.undo.changedColumnOutline')
      record(label, () => patchColumn(col.id, before), () => patchColumn(col.id, after))
    }, t('board.errors.columnColor')),

    setColumnWipLimit: (col: Column, wipLimit: number | null) => changeColumn(col, 'wipLimit', wipLimit, t('board.undo.setWipLimit'), t('board.errors.wipLimit')),

    deleteColumn: (col: Column) => run(async () => {
      await api(`/api/columns/${col.id}`, { method: 'DELETE' })
      columns.value = columns.value.filter(c => c.id !== col.id)
      delete lists.value[col.id]
      for (const g of columnGroups.value) g.columnIds = g.columnIds.filter(c => c !== col.id)
      // Automations of the column (or moving cards into it) are deleted with it.
      automations.value = automations.value.filter(a => a.columnId !== col.id && !('targetColumnId' in a && a.targetColumnId === col.id))
      scheduledActions.value = scheduledActions.value.filter(s => !('targetColumnId' in s && s.targetColumnId === col.id))
      rules.value = rules.value.filter(r => !ruleColumnIds(r).includes(col.id))
    }, t('board.errors.deleteColumn')),

    addColumnRule: (col: Column, rule: NewColumnRule, applyToExisting = true) => run(async () => {
      const body: NewColumnRuleRequest = { ...rule, applyToExisting }
      const created = await api<ColumnRule>(`/api/columns/${col.id}/rules`, { method: 'POST', body })
      if (!col.rules.some(r => r.id === created.id)) col.rules.push(created)
      // Tag and assignee rules can also change the cards already in the column.
      if (applyToExisting && created.kind !== 'set_due' && lists.value[col.id]?.length) await refresh()
    }, t('board.errors.addRule')),

    deleteColumnRule: (col: Column, rule: ColumnRule) => run(async () => {
      col.rules = col.rules.filter(r => r.id !== rule.id)
      await api(`/api/column-rules/${rule.id}`, { method: 'DELETE' })
    }, t('board.errors.deleteRule')),

    addAutomation: (automation: NewBoardAutomation) => run(async () => {
      const created = await api<BoardAutomation>(`/api/boards/${id}/automations`, { method: 'POST', body: automation })
      if (!automations.value.some(a => a.id === created.id)) automations.value.push(created)
    }, t('board.errors.addAutomation')),

    /** Changes the days or pauses/resumes an automation. */
    updateAutomation: (automation: BoardAutomation, patch: { days?: number, active?: boolean }) => run(async () => {
      Object.assign(automation, patch)
      const updated = await api<BoardAutomation>(`/api/automations/${automation.id}`, { method: 'PATCH', body: patch })
      Object.assign(automation, updated)
    }, t('board.errors.updateAutomation')),

    deleteAutomation: (automation: BoardAutomation) => run(async () => {
      automations.value = automations.value.filter(a => a.id !== automation.id)
      await api(`/api/automations/${automation.id}`, { method: 'DELETE' })
    }, t('board.errors.deleteAutomation')),

    addRule: (rule: NewBoardRule) => run(async () => {
      const created = await api<BoardRule>(`/api/boards/${id}/rules`, { method: 'POST', body: rule })
      if (!rules.value.some(r => r.id === created.id)) rules.value.push(created)
    }, t('board.errors.addBoardRule')),

    /** Replaces a rule's event, conditions and actions, or pauses/resumes it ({ active }). */
    updateRule: (rule: BoardRule, patch: NewBoardRule | { active: boolean }) => run(async () => {
      Object.assign(rule, patch)
      const updated = await api<BoardRule>(`/api/board-rules/${rule.id}`, { method: 'PATCH', body: patch })
      Object.assign(rule, updated)
    }, t('board.errors.updateBoardRule')),

    deleteRule: (rule: BoardRule) => run(async () => {
      rules.value = rules.value.filter(r => r.id !== rule.id)
      await api(`/api/board-rules/${rule.id}`, { method: 'DELETE' })
    }, t('board.errors.deleteBoardRule')),

    addScheduledAction: (card: Card, action: NewScheduledCardAction) => run(async () => {
      const created = await api<ScheduledCardAction>(`/api/cards/${card.id}/scheduled-actions`, { method: 'POST', body: action })
      if (!scheduledActions.value.some(s => s.id === created.id)) {
        scheduledActions.value = [...scheduledActions.value, created].sort((a, b) => a.runOn.localeCompare(b.runOn))
      }
    }, t('board.errors.addScheduledAction')),

    deleteScheduledAction: (action: ScheduledCardAction) => run(async () => {
      scheduledActions.value = scheduledActions.value.filter(s => s.id !== action.id)
      await api(`/api/scheduled-actions/${action.id}`, { method: 'DELETE' })
    }, t('board.errors.deleteScheduledAction')),

    /** Sorts a column's cards by priority (urgent first), as one undoable step. */
    sortColumnByPriority: (col: Column) => run(async () => {
      const before = (lists.value[col.id] ?? []).map(c => c.id)
      const after = sortByPriority(lists.value[col.id] ?? []).map(c => c.id)
      if (same(before, after)) return
      await orderColumn(col.id, after)
      record(t('board.undo.sortedColumn'),
        () => orderColumn(col.id, restoreOrder(lists.value[col.id]?.map(c => c.id) ?? gone('column'), before)),
        () => orderColumn(col.id, sortByPriority(lists.value[col.id] ?? gone('column')).map(c => c.id)))
    }, t('board.errors.sortColumn')),

    /** Persists a column's new place after a drag (columns already reordered). */
    columnMoved: (index: number) => run(async () => {
      const col = columns.value[index]!
      const before = dragStart?.columns
      const after = { aboveId: columns.value[index - 1]?.id ?? null, belowId: columns.value[index + 1]?.id ?? null }
      await api(`/api/columns/${col.id}`, { method: 'PATCH', body: after })
      const i = before?.indexOf(col.id) ?? -1
      if (i < 0) return
      const old = { aboveId: before![i - 1] ?? null, belowId: before![i + 1] ?? null }
      if (!same(old, after)) {
        record(t('board.undo.movedColumn'), () => placeColumn(col.id, old.aboveId, old.belowId), () => placeColumn(col.id, after.aboveId, after.belowId))
      }
    }, t('board.errors.moveColumn')),

    addCard: (columnId: string, title: string) => run(async () => {
      // Server returns tags, assignees and due date set by the column's rules.
      const card = await api<Card>(`/api/boards/${id}/cards`, { method: 'POST', body: { columnId, title } })
      lists.value[columnId]!.push(card)
      return card
    }, t('board.errors.addCard')),

    /** Adds a card made from a template at the end of the column (its rules then run). */
    addCardFromTemplate: (columnId: string, template: Card) => run(async () => {
      const card = await api<Card>(`/api/boards/${id}/cards`, { method: 'POST', body: { columnId, templateId: template.id } })
      lists.value[columnId]!.push(card)
      return card
    }, t('board.errors.addCard')),

    /** Saves a copy of the card as a template, optionally with its assignees. */
    saveAsTemplate: (card: Card, withAssignees: boolean) => run(async () => {
      const template = await api<Card>(`/api/cards/${card.id}/template`, { method: 'POST', body: { withAssignees } })
      templates.value = [...templates.value, template].sort((a, b) => a.title.localeCompare(b.title))
      toast.add({ title: t('board.savedTemplate', { title: template.title }), color: 'success' })
      return template
    }, t('board.errors.saveTemplate')),

    /** Deletes a template and its schedule. */
    deleteTemplate: (template: Card) => run(async () => {
      templates.value = templates.value.filter(t => t.id !== template.id)
      recurrences.value = recurrences.value.filter(r => r.templateId !== template.id)
      await api(`/api/cards/${template.id}`, { method: 'DELETE' })
    }, t('board.errors.deleteTemplate')),

    /** Creates or replaces a template's schedule; the server sets the next run. */
    setRecurrence: (template: Card, input: RecurrenceInput) => run(async () => {
      const saved = await api<CardRecurrence>(`/api/cards/${template.id}/recurrence`, { method: 'PUT', body: input })
      recurrences.value = [...recurrences.value.filter(r => r.templateId !== template.id), saved]
    }, t('board.errors.saveSchedule')),

    deleteRecurrence: (template: Card) => run(async () => {
      recurrences.value = recurrences.value.filter(r => r.templateId !== template.id)
      await api(`/api/cards/${template.id}/recurrence`, { method: 'DELETE' })
    }, t('board.errors.stopRepeating')),

    updateCard: (card: Card, patch: CardPatch) => run(async () => {
      const { archived, ...local } = patch
      const keys = (Object.keys(local) as (keyof typeof local)[]).filter(k => !same(card[k], local[k]))
      const before = structuredClone(Object.fromEntries(keys.map(k => [k, toRaw(card[k])]))) as CardPatch
      const after = structuredClone(Object.fromEntries(keys.map(k => [k, toRaw(local[k])]))) as CardPatch
      Object.assign(card, local)
      Object.assign(card, await api<Card>(`/api/cards/${card.id}`, { method: 'PATCH', body: patch }))
      if (archived === undefined && keys.length && !isTemplate(card)) {
        record(t(cardEditLabel(keys)), () => patchCard(card.id, before), () => patchCard(card.id, after))
      }
    }, t('board.errors.saveCard')),

    /** Local only: counts changed in the card dialog (checklist, comments, attachments, time, deleted cover, watching). */
    setCardCounts: (card: Card, counts: CardCounts) => {
      Object.assign(card, counts)
    },

    /** Local only: a link added or removed in the card dialog of `card`; keeps blockerIds in step. */
    cardLinkChanged: (card: Card, link: CardLink, added: boolean) => {
      if (link.kind !== 'blocks') return
      const [blocker, blocked] = link.direction === 'out' ? [card.id, link.card.id] : [link.card.id, card.id]
      const target = Object.values(lists.value).flat().find(c => c.id === blocked)
      if (!target) return
      target.blockerIds = added ? [...new Set([...target.blockerIds, blocker])] : target.blockerIds.filter(id => id !== blocker)
    },

    archiveCard: (card: Card) => run(async () => {
      removeCard(card)
      await api(`/api/cards/${card.id}`, { method: 'PATCH', body: { archived: true } })
      record(t('board.undo.archivedCard'), () => setCardArchived(card.id, false), () => setCardArchived(card.id, true))
    }, t('board.errors.archiveCard')),

    /** Hides the card from the board until `until` (YYYY-MM-DD); undo wakes it. */
    snoozeCard: (card: Card, until: string) => run(async () => {
      removeCard(card)
      await api(`/api/cards/${card.id}`, { method: 'PATCH', body: { snoozedUntil: until } })
      record(t('board.undo.snoozedCard'), () => setCardSnoozed(card.id, null), () => setCardSnoozed(card.id, until))
    }, t('board.errors.snoozeCard')),

    /** Brings a snoozed card back now (reloads the board to place it). */
    wakeCard: (cardId: string) => run(() => setCardSnoozed(cardId, null), t('board.errors.wakeCard')),

    /** Brings an archived card back to its column (reloads the board to place it). */
    restoreCard: (cardId: string) => run(async () => {
      await api(`/api/cards/${cardId}`, { method: 'PATCH', body: { archived: false } })
      await refresh()
    }, t('board.errors.restoreCard')),

    /** Moves the card to the board's trash; undo restores it. */
    deleteCard: (card: Card) => run(async () => {
      removeCard(card)
      await api(`/api/cards/${card.id}`, { method: 'DELETE' })
      record(t('board.undo.deletedCard'), () => setCardTrashed(card.id, false), () => setCardTrashed(card.id, true))
    }, t('board.errors.deleteCard')),

    /** Moves an archived card (not in any list) to the trash. */
    deleteArchivedCard: (cardId: string) => run(async () => {
      await api(`/api/cards/${cardId}`, { method: 'DELETE' })
    }, t('board.errors.deleteCard')),

    /** Brings a card back from the trash (reloads the board to place it). */
    restoreTrashedCard: (cardId: string) => run(() => setCardTrashed(cardId, false), t('trash.restoreFailed')),

    addTag: (tag: Omit<Tag, 'id'>) => run(async () => {
      const created = await api<Tag>(`/api/boards/${id}/tags`, { method: 'POST', body: tag })
      tags.value = [...tags.value, created].sort((a, b) => a.name.localeCompare(b.name))
      return created
    }, t('board.errors.addTag')),

    updateTag: (tag: Tag, patch: Partial<Omit<Tag, 'id'>>) => run(async () => {
      const before = Object.fromEntries(Object.keys(patch).map(k => [k, tag[k as keyof typeof patch]]))
      await patchTag(tag.id, patch)
      if (!same(before, patch)) record(t('board.undo.changedTag'), () => patchTag(tag.id, before), () => patchTag(tag.id, patch))
    }, t('board.errors.saveTag')),

    deleteTag: (tag: Tag) => run(async () => {
      await api(`/api/tags/${tag.id}`, { method: 'DELETE' })
      tags.value = tags.value.filter(t => t.id !== tag.id)
      for (const list of Object.values(lists.value)) {
        for (const card of list) card.tagIds = card.tagIds.filter(t => t !== tag.id)
      }
      for (const col of columns.value) col.rules = col.rules.filter(r => !('tagId' in r && r.tagId === tag.id))
      automations.value = automations.value.filter(a => !('tagId' in a && a.tagId === tag.id))
      rules.value = rules.value.filter(r => !ruleTagIds(r).includes(tag.id))
    }, t('board.errors.deleteTag')),

    addField: (field: NewBoardField) => run(async () => {
      const created = await api<BoardField>(`/api/boards/${id}/fields`, { method: 'POST', body: field })
      if (!fields.value.some(f => f.id === created.id)) fields.value.push(created)
    }, t('board.errors.addField')),

    /** Removing a select option clears the values that used it (on the server too). */
    updateField: (field: BoardField, patch: Partial<Pick<BoardField, 'name' | 'options' | 'showOnCard'>>) => run(async () => {
      Object.assign(field, patch)
      if (patch.options) clearFieldValues(field.id, v => !field.options.some(o => o.id === v))
      await api(`/api/fields/${field.id}`, { method: 'PATCH', body: patch })
    }, t('board.errors.saveField')),

    /** Persists a field's new place after a drag (fields already reordered). */
    fieldMoved: (index: number) => run(async () => {
      const field = fields.value[index]!
      Object.assign(field, await api<BoardField>(`/api/fields/${field.id}`, {
        method: 'PATCH',
        body: { aboveId: fields.value[index - 1]?.id ?? null, belowId: fields.value[index + 1]?.id ?? null },
      }))
    }, t('board.errors.moveField')),

    addColumnGroup: (group: Pick<ColumnGroup, 'name' | 'color' | 'columnIds'>) => run(async () => {
      const created = await api<ColumnGroup>(`/api/boards/${id}/column-groups`, { method: 'POST', body: group })
      if (!columnGroups.value.some(g => g.id === created.id)) columnGroups.value.push(created)
    }, t('board.errors.addColumnGroup')),

    /** columnIds replaces the group's columns (kept in board order). */
    updateColumnGroup: (group: ColumnGroup, patch: Partial<Pick<ColumnGroup, 'name' | 'color' | 'columnIds'>>) => run(async () => {
      Object.assign(group, patch)
      if (patch.columnIds) group.columnIds = columns.value.map(c => c.id).filter(c => patch.columnIds!.includes(c))
      await api(`/api/column-groups/${group.id}`, { method: 'PATCH', body: patch })
    }, t('board.errors.saveColumnGroup')),

    /** Persists a group's new place after a drag (groups already reordered). */
    columnGroupMoved: (index: number) => run(async () => {
      const group = columnGroups.value[index]!
      Object.assign(group, await api<ColumnGroup>(`/api/column-groups/${group.id}`, {
        method: 'PATCH',
        body: { aboveId: columnGroups.value[index - 1]?.id ?? null, belowId: columnGroups.value[index + 1]?.id ?? null },
      }))
    }, t('board.errors.moveColumnGroup')),

    deleteColumnGroup: (group: ColumnGroup) => run(async () => {
      await api(`/api/column-groups/${group.id}`, { method: 'DELETE' })
      columnGroups.value = columnGroups.value.filter(g => g.id !== group.id)
    }, t('board.errors.deleteColumnGroup')),

    addAssigneeGroup: (group: Pick<AssigneeGroup, 'name' | 'userIds'>) => run(async () => {
      const created = await api<AssigneeGroup>(`/api/boards/${id}/assignee-groups`, { method: 'POST', body: group })
      if (!assigneeGroups.value.some(g => g.id === created.id)) assigneeGroups.value = sortAssigneeGroups([...assigneeGroups.value, created])
    }, t('board.errors.addAssigneeGroup')),

    /** userIds replaces the group's members. */
    updateAssigneeGroup: (group: AssigneeGroup, patch: Partial<Pick<AssigneeGroup, 'name' | 'userIds'>>) => run(async () => {
      Object.assign(group, patch)
      Object.assign(group, await api<AssigneeGroup>(`/api/assignee-groups/${group.id}`, { method: 'PATCH', body: patch }))
      if (patch.name) assigneeGroups.value = sortAssigneeGroups([...assigneeGroups.value])
    }, t('board.errors.saveAssigneeGroup')),

    deleteAssigneeGroup: (group: AssigneeGroup) => run(async () => {
      await api(`/api/assignee-groups/${group.id}`, { method: 'DELETE' })
      assigneeGroups.value = assigneeGroups.value.filter(g => g.id !== group.id)
    }, t('board.errors.deleteAssigneeGroup')),

    /** Saves a view. Throws on failure, so the dialog can show a taken name (409) next to the input. */
    addSavedView: async (input: { name: string, shared: boolean, config: SavedViewConfig }) => {
      const created = await api<SavedView>(`/api/boards/${id}/saved-views`, { method: 'POST', body: input })
      savedViews.value = sortSavedViews([...savedViews.value.filter(v => v.id !== created.id), created])
      return created
    },

    /** Renames a view or replaces its settings. Throws on failure, like addSavedView. */
    updateSavedView: async (view: SavedView, patch: { name?: string, config?: SavedViewConfig }) => {
      const updated = await api<SavedView>(`/api/saved-views/${view.id}`, { method: 'PATCH', body: patch })
      savedViews.value = sortSavedViews(savedViews.value.map(v => v.id === updated.id ? updated : v))
      return updated
    },

    deleteSavedView: (view: SavedView) => run(async () => {
      await api(`/api/saved-views/${view.id}`, { method: 'DELETE' })
      savedViews.value = savedViews.value.filter(v => v.id !== view.id)
    }, t('savedViews.errors.delete')),

    /** Creates a button. Throws on failure, so the dialog can show a taken name (409). */
    addButton: async (input: Omit<BoardButton, 'id'>) => {
      const created = await api<BoardButton>(`/api/boards/${id}/buttons`, { method: 'POST', body: input })
      buttons.value = sortSavedViews([...buttons.value.filter(b => b.id !== created.id), created])
      return created
    },

    /** Changes a button's name, look, columns or steps. Throws on failure, like addButton. */
    updateButton: async (button: BoardButton, patch: Partial<Pick<BoardButton, 'name' | 'icon' | 'color' | 'columnIds' | 'steps'>>) => {
      const updated = await api<BoardButton>(`/api/buttons/${button.id}`, { method: 'PATCH', body: patch })
      buttons.value = sortSavedViews(buttons.value.map(b => b.id === updated.id ? updated : b))
      return updated
    },

    deleteButton: (button: BoardButton) => run(async () => {
      await api(`/api/buttons/${button.id}`, { method: 'DELETE' })
      buttons.value = buttons.value.filter(b => b.id !== button.id)
    }, t('buttons.errors.delete')),

    /**
     * Runs a button (on `card` for card buttons), then reloads the board and
     * open dialogs. Not undoable; the card activity shows what changed.
     */
    runButton: (button: BoardButton, card?: Card) => run(async () => {
      const res = await api<ButtonRunResult>(`/api/buttons/${button.id}/run`, { method: 'POST', body: { cardId: card?.id } })
      await refresh()
      remoteVersion.value++
      toast.add({
        title: t('buttons.ran', { name: button.name }),
        description: res.skipped ? t('buttons.skipped', { n: res.skipped }, res.skipped) : undefined,
        color: res.skipped ? 'warning' : 'success',
      })
    }, t('buttons.errors.run', { name: button.name })),

    deleteField: (field: BoardField) => run(async () => {
      await api(`/api/fields/${field.id}`, { method: 'DELETE' })
      fields.value = fields.value.filter(f => f.id !== field.id)
      clearFieldValues(field.id)
    }, t('board.errors.deleteField')),

    /** Sets or (with null) clears a card's value for a field. */
    setFieldValue: (card: Card, field: BoardField, value: FieldValue | null) => run(async () => {
      const before = structuredClone(toRaw(card.fields[field.id] ?? null))
      await putFieldValue(card.id, field.id, value)
      if (!same(before, value) && !isTemplate(card)) {
        record(t('board.undo.changedField', { field: field.name }), () => putFieldValue(card.id, field.id, before), () => putFieldValue(card.id, field.id, value))
      }
    }, t('board.errors.saveFieldValue', { field: field.name })),

    /**
     * Applies one change to several cards at once (all or none) as one undo step.
     * Undo puts moved cards back next to their old neighbours, one by one.
     */
    bulkUpdate: (cardIds: string[], action: BulkCardAction) => run(async () => {
      const order = listIds()
      const before = cardIds.map(cardId => structuredClone(toRaw(findCard(cardId))))
      await sendBulk(cardIds, action)
      const inverse = bulkInverse(before, action)
      const moved = action.columnId
        ? columns.value.flatMap(c => order[c.id] ?? []).filter(cardId => cardIds.includes(cardId))
            .map(cardId => [cardId, placementIn(order, cardId)!] as const)
        : []
      record(t(bulkLabel(action), { n: cardIds.length }, cardIds.length), async () => {
        if (action.archived !== undefined) await sendBulk(cardIds, { archived: !action.archived })
        for (const { cardIds, ...undo } of inverse) await sendBulk(cardIds, undo)
        for (const [cardId, from] of moved) await placeCard(cardId, from)
      }, () => sendBulk(cardIds, action))
    }, t('board.errors.bulk')),

    /** Persists a card's new place after a drag (lists already updated). */
    cardMoved,

    /**
     * Moves a card to `index` of a column's full card list (default: the end)
     * and persists it. Used by views that do not drag the lists themselves.
     */
    moveCard: (card: Card, columnId: string, index?: number) => {
      const from = placementIn(listIds(), card.id)
      removeCard(card)
      const list = lists.value[columnId]!
      const at = index ?? list.length
      list.splice(at, 0, card)
      return cardMoved(columnId, at, from)
    },

    /** Reverts this tab's latest undoable change (Ctrl/Cmd+Z). */
    undo,
    redo,
    /** Runs `fn` so the changes it makes undo as one step, e.g. a swimlane drop (move plus lane value). */
    undoGroup: <T>(label: string, fn: () => Promise<T>) => undoStack.group(label, fn),
  }

  return {
    board, error, refresh, columns, columnGroups, assigneeGroups, savedViews, buttons, lists, tags, fields, templates, recurrences, automations, rules, scheduledActions, archived, offline, canEdit, isOwner, limited, canEditCard, canCommentOn, canAddToColumn, dragging, remoteVersion,
    canUndo: undoStack.canUndo, canRedo: undoStack.canRedo, ...mutations,
  }
}
