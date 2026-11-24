<script setup lang="ts">
// A card of some board opened outside its board page (custom views, /views/:id):
// loads that board through useBoard so the dialog edits it as on the board.
// Mount inside <Suspense> (useBoard is async).
const props = defineProps<{ boardId: string, cardId: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const toast = useToast()
const base = basePath()

const {
  board, lists, columns, tags, fields, assigneeGroups, buttons, remoteVersion, archived, offline, canEdit, isOwner, limited,
  canEditCard, canCommentOn, canAddToColumn,
  addTag, updateTag, updateCard, setCardCounts, archiveCard, snoozeCard, deleteCard, cardLinkChanged, setFieldValue, moveCard,
  saveAsTemplate, runButton, setButtonOnCard,
} = await useBoard(props.boardId, { onGone: () => emit('close') })

const currentId = ref(props.cardId)
const allCards = computed(() => Object.values(lists.value).flat())
const card = computed(() => allCards.value.find(c => c.id === currentId.value) ?? null)
// The card is gone (archived, trashed or moved out of sight): close.
watch(card, (c) => { if (!c) emit('close') }, { immediate: true })
const open = computed({ get: () => !!card.value, set: (v) => { if (!v) emit('close') } })
const cardButtons = computed(() => buttons.value.filter(b => b.scope === 'card'))
const link = computed(() => card.value && import.meta.client
  ? `${window.location.origin}${base}/boards/${props.boardId}?card=${card.value.id}`
  : undefined)

function openLinkedCard(cardId: string) {
  if (!allCards.value.some(c => c.id === cardId)) {
    toast.add({ title: t('board.cardArchived'), color: 'warning' })
    return
  }
  currentId.value = cardId
}
</script>

<template>
  <CardModal
    v-if="card && board"
    v-model:open="open"
    :card="card"
    :members="board.members"
    :assignee-groups="assigneeGroups"
    :tags="tags"
    :fields="fields"
    :cards="allCards"
    :columns="columns"
    :can-edit="canEditCard(card)"
    :can-comment="canCommentOn(card)"
    :can-create-tags="canEdit"
    :move-column-ids="limited ? columns.filter(c => canAddToColumn(c.id)).map(c => c.id) : undefined"
    :is-owner="isOwner && !archived"
    :can-react="!archived && !offline"
    :create-tag="addTag"
    :remote-version="remoteVersion"
    :link="link"
    :matrix="board.matrix"
    :buttons="cardButtons"
    :button-align="board.buttonAlign"
    @update-tag="updateTag"
    @save="patch => updateCard(card!, patch)"
    @counts="counts => setCardCounts(card!, counts)"
    @archive="archiveCard(card!)"
    @snooze="until => snoozeCard(card!, until)"
    @delete="deleteCard(card!)"
    @save-template="withAssignees => saveAsTemplate(card!, withAssignees)"
    @open-card="openLinkedCard"
    @link="(l, added) => cardLinkChanged(card!, l, added)"
    @set-field="(field, value) => setFieldValue(card!, field, value)"
    @move="columnId => moveCard(card!, columnId)"
    @run-button="b => runButton(b, card!)"
    @button-on-card="(b, on) => setButtonOnCard(b, card!, on)"
  />
</template>
