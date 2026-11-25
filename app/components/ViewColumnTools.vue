<script setup lang="ts">
import type { Ref } from 'vue'
import type { BoardButton } from '#shared/buttons'

// Column controls of one board shown outside its board page (custom views,
// /views/:id): loads the board through useBoard so the column menu works as on
// the board (same dialogs, mutations and undo). The page sends each menu choice
// as `request`; `changed` fires once a change has settled, so the page reloads
// its copy of the board (this tab gets no live event for its own changes).
// Mount inside <Suspense> (useBoard is async) and keep it mounted while the
// page is open, so undo toasts outlive the dialogs.
export type ViewColumnRequest =
  | { kind: 'edit' | 'colour' | 'rules' | 'automations' | 'sort' | 'delete', columnId: string }
  | { kind: 'rename', columnId: string, title: string }
  | { kind: 'group', columnId: string, groupId: string, member: boolean }
  | { kind: 'groups' }

const props = defineProps<{ boardId: string, request: (ViewColumnRequest & { n: number }) | null }>()
const emit = defineEmits<{ changed: [], gone: [] }>()
const { t } = useI18n()
const showError = useApiError()

const {
  board, columns, columnGroups, lists, tags, buttons, automations, scheduledActions, canEdit,
  renameColumn, editColumn, setColumnAppearance, deleteColumn, sortColumnByPriority,
  addColumnRule, deleteColumnRule, addAutomation, updateAutomation, deleteAutomation,
  addColumnGroup, updateColumnGroup, columnGroupMoved, deleteColumnGroup, updateButton,
} = await useBoard(props.boardId, { onGone: () => emit('gone'), onChange: () => emit('changed') })

const allCards = computed(() => Object.values(lists.value).flat())
const column = (columnId: string) => columns.value.find(c => c.id === columnId) ?? null

const editingId = ref<string | null>(null)
const colouringId = ref<string | null>(null)
const rulesId = ref<string | null>(null)
const automationsColumnId = ref<string | null>(null)
const automationsOpen = ref(false)
const groupsOpen = ref(false)
const editing = computed(() => editingId.value ? column(editingId.value) : null)
const colouring = computed(() => colouringId.value ? column(colouringId.value) : null)
const rulesColumn = computed(() => rulesId.value ? column(rulesId.value) : null)
const openFor = (id: Ref<string | null>) => computed({ get: () => !!id.value, set: (v) => { if (!v) id.value = null } })
const editOpen = openFor(editingId)
const colourOpen = openFor(colouringId)
const rulesOpen = openFor(rulesId)

// As on the board page: card buttons whose columns the user may change from the column's rules.
const cardButtons = computed(() => buttons.value.filter(b => b.scope === 'card'))
const manageableCardButtons = computed(() => cardButtons.value.filter(b => !b.shared || canEdit.value))
const sharedCardButtons = computed(() => cardButtons.value.filter(b => b.shared))
async function setButtonColumns(button: BoardButton, columnIds: string[] | null) {
  try {
    await updateButton(button, { columnIds })
    emit('changed')
  }
  catch (err) { showError(err, t('buttons.errors.save')) }
}

function handle(req: ViewColumnRequest) {
  if (req.kind === 'groups') {
    groupsOpen.value = true
    return
  }
  const col = column(req.columnId)
  if (!col) return
  switch (req.kind) {
    case 'edit': editingId.value = col.id; break
    case 'colour': colouringId.value = col.id; break
    case 'rules': rulesId.value = col.id; break
    case 'automations':
      automationsColumnId.value = col.id
      automationsOpen.value = true
      break
    case 'sort': sortColumnByPriority(col); break
    case 'delete': deleteColumn(col); break
    case 'rename': renameColumn(col, req.title); break
    case 'group': {
      const group = columnGroups.value.find(g => g.id === req.groupId)
      if (group) updateColumnGroup(group, { columnIds: toggleColumn(group.columnIds, col.id, req.member) })
      break
    }
  }
}
watch(() => props.request, (req) => { if (req) handle(req) }, { immediate: true })
</script>

<template>
  <template v-if="board">
    <ColumnEditModal
      v-if="editing"
      v-model:open="editOpen"
      :column="editing"
      @save="value => editColumn(editing!, value)"
    />
    <ColumnColorModal
      v-if="colouring"
      v-model:open="colourOpen"
      :title="colouring.title"
      :color="colouring.color"
      :outline="colouring.outline"
      :board-outline="board.columnOutline"
      @save="value => setColumnAppearance(colouring!, value)"
    />
    <ColumnRulesModal
      v-if="rulesColumn"
      v-model:open="rulesOpen"
      :column="rulesColumn"
      :tags="tags"
      :members="board.members"
      :cards="lists[rulesColumn.id] ?? []"
      :buttons="manageableCardButtons"
      :rule-buttons="sharedCardButtons"
      :column-ids="columns.map(c => c.id)"
      @add="(rule, applyToExisting) => addColumnRule(rulesColumn!, rule, applyToExisting)"
      @delete="rule => deleteColumnRule(rulesColumn!, rule)"
      @button-columns="setButtonColumns"
    />
    <BoardAutomationsModal
      v-if="automationsOpen"
      v-model:open="automationsOpen"
      :automations="automations"
      :tags="tags"
      :columns="columns"
      :column-id="automationsColumnId"
      :cards="allCards"
      :card="null"
      :scheduled-actions="scheduledActions"
      :can-edit="canEdit"
      @add="addAutomation"
      @update="updateAutomation"
      @delete="deleteAutomation"
    />
    <ColumnGroupsModal
      v-if="groupsOpen"
      v-model:open="groupsOpen"
      v-model:groups="columnGroups"
      :columns="columns"
      @create="addColumnGroup"
      @update="updateColumnGroup"
      @move="columnGroupMoved"
      @delete="deleteColumnGroup"
    />
  </template>
</template>
