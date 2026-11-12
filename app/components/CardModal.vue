<script setup lang="ts">
import { priorities, type BoardField, type Card, type CardLink, type CardPatch, type CardRecurrence, type Column, type FieldValue, type Member, type RecurrenceInput, type Tag } from '#shared/types/board'
import type { CardCounts } from '~/composables/useBoard'
import { CARD_TITLE_MAX } from '#shared/cards'

const props = defineProps<{
  card: Card
  members: Member[]
  tags: Tag[]
  /** Custom fields; their values save at once, not with the form. */
  fields: BoardField[]
  /** The board's unarchived cards and its columns, for links. */
  cards: Card[]
  columns: Column[]
  canEdit: boolean
  isOwner: boolean
  createTag: (tag: Omit<Tag, 'id'>) => Promise<Tag | undefined>
  /** Changes when someone else changed the board; the dialog then reloads its details. */
  remoteVersion: number
  /**
   * Edit a card template: no dates, links, attachments, time, comments or
   * activity; a Repeat section instead.
   */
  template?: boolean
  /** The template's schedule, if any. */
  recurrence?: CardRecurrence | null
  /** Direct link to the card, offered by "Copy link". */
  link?: string
}>()
const emit = defineEmits<{
  save: [patch: CardPatch]
  updateTag: [tag: Tag, patch: Partial<Omit<Tag, 'id'>>]
  counts: [counts: CardCounts]
  archive: []
  delete: []
  /** Open another card (a linked one) instead of this one. */
  openCard: [cardId: string]
  link: [link: CardLink, added: boolean]
  setField: [field: BoardField, value: FieldValue | null]
  saveTemplate: [withAssignees: boolean]
  setRecurrence: [input: RecurrenceInput]
  deleteRecurrence: []
  /** Move the card to the end of another column. */
  move: [columnId: string]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const choose = useChoice()
const toast = useToast()

async function copyLink() {
  try {
    await navigator.clipboard.writeText(props.link!)
    toast.add({ title: t('card.linkCopied'), color: 'success' })
  } catch {
    toast.add({ title: t('card.linkCopyFailed'), color: 'error' })
  }
}

const form = reactive({
  title: '',
  description: '',
  assigneeIds: [] as string[],
  tagIds: [] as string[],
  startDate: '',
  dueDate: '',
  priority: null as Card['priority'],
  // Text of the number input; empty = no estimate.
  estimate: '',
})
// Reset only when the dialog opens or shows another card, so a board reload keeps the draft.
watch(() => [open.value, props.card.id] as const, ([isOpen]) => {
  if (!isOpen) return
  const c = props.card
  Object.assign(form, {
    title: c.title,
    description: c.description,
    assigneeIds: [...c.assigneeIds],
    tagIds: [...c.tagIds],
    startDate: c.startDate ?? '',
    dueDate: c.dueDate ?? '',
    priority: c.priority,
    estimate: c.estimate?.toString() ?? '',
  })
}, { immediate: true })

// A move can change tags, assignees and dates (column rules). Take the card's new
// values into fields the user has not edited, so a later Save keeps them.
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))
watch(() => {
  const c = props.card
  return { id: c.id, tagIds: [...c.tagIds], assigneeIds: [...c.assigneeIds], startDate: c.startDate ?? '', dueDate: c.dueDate ?? '' }
}, (now, before) => {
  if (!before || now.id !== before.id) return
  if (sameSet(form.tagIds, before.tagIds)) form.tagIds = now.tagIds
  if (sameSet(form.assigneeIds, before.assigneeIds)) form.assigneeIds = now.assigneeIds
  if (form.startDate === before.startDate) form.startDate = now.startDate
  if (form.dueDate === before.dueDate) form.dueDate = now.dueDate
})

const columnItems = computed(() => props.columns.map(c => ({ label: c.title, value: c.id })))
const columnTitle = computed(() => props.columns.find(c => c.id === props.card.columnId)?.title ?? '')
// Archived cards are not in the board's lists, so they cannot be moved from here.
const canMove = computed(() => props.canEdit && props.cards.some(c => c.id === props.card.id))

const cardId = computed(() => props.card.id)
const cd = useCardDetail(cardId)
watch(() => [open.value, props.card.id, props.remoteVersion] as const, ([isOpen]) => {
  if (isOpen) cd.load()
}, { immediate: true })

// Keep the board's badges in step with the details.
watch(() => cd.detail.value, (d) => {
  if (!d) return
  emit('counts', {
    checklist: { done: d.checklist.filter(i => i.done).length, total: d.checklist.length },
    commentCount: d.comments.length,
    attachmentCount: d.attachments.length,
    timeMinutes: d.timeTotal,
    watching: d.watching,
    // Deleting the cover image clears it on the server too.
    coverAttachmentId: d.attachments.some(a => a.id === props.card.coverAttachmentId) ? props.card.coverAttachmentId : null,
  })
}, { deep: true })

async function saveTemplate() {
  let withAssignees = false
  if (props.card.assigneeIds.length > 0) {
    const answer = await choose({ title: t('card.keepAssigneesOnTemplate'), confirmLabel: t('card.keepAssignees'), cancelLabel: t('card.dropAssignees'), color: 'primary' })
    if (answer === null) return
    withAssignees = answer
  }
  emit('saveTemplate', withAssignees)
}

const { user } = useUserSession()
function toggleWatch() {
  const d = cd.detail.value
  if (!d || !user.value) return
  cd.setWatching(!d.watching, { userId: user.value.id, name: user.value.name, avatarUrl: user.value.avatarUrl ?? null })
}

const memberItems = computed(() => props.members.map(m => ({
  label: m.name, value: m.userId, avatar: { src: m.avatarUrl ?? undefined, alt: m.name },
})))
// Assignees who lost access stay on the card until removed.
const formerAssignees = computed(() => form.assigneeIds.filter(id => !props.members.some(m => m.userId === id)))
const priorityItems = computed(() => [
  { label: t('common.none'), value: null, icon: 'i-lucide-minus' },
  ...priorities.map(p => ({ label: t(`priority.${p}`), value: p, icon: priorityMeta[p].icon })),
])

const selectedTags = computed(() => props.tags.filter(t => form.tagIds.includes(t.id)))

// A tag typed into the select is not created at once: the user picks its colour first.
const newTag = ref<{ name: string, color: string } | null>(null)
const creatingTag = ref(false)

function addTag(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  const color = newTag.value?.color ?? colorPresets[Math.floor(Math.random() * colorPresets.length)]!
  newTag.value = { name: trimmed.slice(0, 50), color }
}

async function confirmNewTag() {
  const draft = newTag.value
  const name = draft?.name.trim()
  if (!draft || !name || creatingTag.value) return
  creatingTag.value = true
  try {
    const tag = await props.createTag({ name, color: draft.color })
    if (tag) {
      form.tagIds.push(tag.id)
      newTag.value = null
    }
  }
  finally {
    creatingTag.value = false
  }
}

// Tag whose colour is open in a popover. Tag colours are board-wide and save on close, not with the card.
const picking = ref<{ id: string, color: string } | null>(null)

function setPicking(tag: Tag, isOpen: boolean) {
  if (isOpen) {
    picking.value = { id: tag.id, color: tag.color }
    return
  }
  const p = picking.value
  picking.value = null
  if (p?.id === tag.id && p.color !== tag.color) emit('updateTag', tag, { color: p.color })
}

const estimate = computed(() => {
  const text = String(form.estimate ?? '').trim()
  return text === '' ? null : Number(text)
})
const estimateInvalid = computed(() => estimate.value !== null && !(Number.isFinite(estimate.value) && estimate.value >= 0 && estimate.value <= 9999))
const datesInvalid = computed(() => !!form.startDate && !!form.dueDate && form.startDate > form.dueDate)
const titleLength = computed(() => form.title.trim().length)
const titleTooLong = computed(() => titleLength.value > CARD_TITLE_MAX)
const invalid = computed(() => !form.title.trim() || titleTooLong.value || estimateInvalid.value || datesInvalid.value)

const dirty = computed(() => {
  const c = props.card
  return form.title.trim() !== c.title || form.description !== c.description
    || !sameSet(form.assigneeIds, c.assigneeIds) || !sameSet(form.tagIds, c.tagIds)
    || (form.startDate || null) !== c.startDate || (form.dueDate || null) !== c.dueDate
    || form.priority !== c.priority || estimate.value !== c.estimate
})

function save() {
  if (invalid.value) return
  emit('save', {
    title: form.title.trim(),
    description: form.description,
    assigneeIds: form.assigneeIds,
    tagIds: form.tagIds,
    startDate: form.startDate || null,
    dueDate: form.dueDate || null,
    priority: form.priority,
    estimate: estimate.value,
  })
}

// The title is a textarea so long titles wrap; Enter still saves like the old input did.
function onTitleEnter(e: KeyboardEvent) {
  if (e.isComposing) return
  e.preventDefault()
  save()
}

// Ctrl/Cmd+Enter submits what is being edited: the card (title, description and
// sidebar fields) or another form inside the dialog, such as a comment.
function onModKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.isComposing || e.defaultPrevented) return
  const target = e.target as HTMLElement
  const form = target.closest('form')
  if (form && form.id !== 'card-form') {
    e.preventDefault()
    form.requestSubmit()
  }
  else if (props.canEdit && (form || target.closest('aside'))) {
    e.preventDefault()
    if (dirty.value) save()
  }
}

const tab = ref('comments')
const tabs = computed(() => [
  {
    label: cd.detail.value?.comments.length ? t('card.commentsCount', { count: cd.detail.value.comments.length }) : t('card.comments'),
    value: 'comments',
    icon: 'i-lucide-message-square',
    slot: 'comments' as const,
  },
  { label: t('card.activity'), value: 'activity', icon: 'i-lucide-history', slot: 'activity' as const },
])
</script>

<template>
  <UModal v-model:open="open" :title="props.canEdit ? (props.template ? t('card.editTemplate') : t('card.editCard')) : form.title" :ui="{ content: 'sm:max-w-4xl' }">
    <template #body>
      <div class="grid gap-6 md:grid-cols-[1fr_16rem]" @keydown="onModKeydown">
        <div class="space-y-6 min-w-0">
          <form id="card-form" class="space-y-4" @submit.prevent="save">
            <UFormField
              v-if="props.canEdit"
              :label="t('card.title')"
              required
              :hint="titleLength > CARD_TITLE_MAX - 100 ? t('card.titleCount', { count: titleLength, max: CARD_TITLE_MAX }) : undefined"
              :error="titleTooLong ? t('card.errors.titleTooLong', { max: CARD_TITLE_MAX }) : undefined"
            >
              <UTextarea
                :model-value="form.title"
                :maxlength="CARD_TITLE_MAX"
                autoresize
                :rows="1"
                :maxrows="6"
                class="w-full"
                @update:model-value="v => form.title = String(v).replace(/\s*[\r\n]+\s*/g, ' ')"
                @keydown.enter.exact="onTitleEnter"
              />
            </UFormField>
            <UFormField :label="t('card.description')">
              <MarkdownEditor v-if="props.canEdit" v-model="form.description" :placeholder="t('card.descriptionPlaceholder')" />
              <MarkdownText v-else-if="form.description" :text="form.description" />
              <p v-else class="text-sm text-muted">
                {{ t('card.noDescription') }}
              </p>
            </UFormField>
          </form>

          <CardChecklist :items="cd.detail.value?.checklist ?? null" :can-edit="props.canEdit" :cd="cd" />
          <CardRecurrenceForm
            v-if="props.template"
            :recurrence="props.recurrence ?? null"
            :columns="props.columns"
            :default-column-id="props.card.columnId"
            :can-edit="props.canEdit"
            @save="input => emit('setRecurrence', input)"
            @remove="emit('deleteRecurrence')"
          />
          <template v-else>
            <CardLinks
              :items="cd.detail.value?.links ?? null"
              :card-id="props.card.id"
              :cards="props.cards"
              :columns="props.columns"
              :can-edit="props.canEdit"
              :cd="cd"
              @open="id => emit('openCard', id)"
              @changed="(link, added) => emit('link', link, added)"
            />
            <CardAttachments
              :items="cd.detail.value?.attachments ?? null"
              :can-edit="props.canEdit"
              :cd="cd"
              :cover-id="props.card.coverAttachmentId"
              @cover="coverAttachmentId => emit('save', { coverAttachmentId })"
            />
            <CardTime
              :items="cd.detail.value?.timeEntries ?? null"
              :total="cd.detail.value?.timeTotal ?? 0"
              :can-edit="props.canEdit"
              :is-owner="props.isOwner"
              :cd="cd"
            />

            <UTabs v-model="tab" :items="tabs" variant="link" class="w-full">
              <template #comments>
                <CardComments
                  :items="cd.detail.value?.comments ?? null"
                  :can-edit="props.canEdit"
                  :is-owner="props.isOwner"
                  :cd="cd"
                  :members="props.members"
                />
              </template>
              <template #activity>
                <CardActivity :items="cd.detail.value?.activity ?? null" />
              </template>
            </UTabs>
          </template>
        </div>

        <aside class="space-y-4">
          <UFormField v-if="!props.template" :label="t('card.list')">
            <USelect
              v-if="canMove"
              :model-value="props.card.columnId"
              :items="columnItems"
              class="w-full"
              @update:model-value="(v: string) => v !== props.card.columnId && emit('move', v)"
            />
            <p v-else class="text-sm">
              {{ columnTitle }}
            </p>
          </UFormField>
          <div v-if="cd.detail.value && !props.template" class="flex items-center gap-2">
            <UButton
              :icon="cd.detail.value.watching ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :label="cd.detail.value.watching ? t('card.unwatch') : t('card.watch')"
              color="neutral"
              variant="outline"
              size="sm"
              @click="toggleWatch"
            />
            <UTooltip v-if="props.link" :text="t('card.copyLink')">
              <UButton
                icon="i-lucide-link"
                :aria-label="t('card.copyLink')"
                color="neutral"
                variant="outline"
                size="sm"
                @click="copyLink"
              />
            </UTooltip>
            <UTooltip v-if="cd.detail.value.watchers.length" :text="t('card.watchers', { names: cd.detail.value.watchers.map(w => w.name).join(', ') })">
              <UAvatarGroup
                :max="4"
                size="2xs"
                class="ms-auto"
              >
                <UAvatar v-for="w in cd.detail.value.watchers" :key="w.userId" :src="w.avatarUrl ?? undefined" :alt="w.name" />
              </UAvatarGroup>
            </UTooltip>
          </div>
          <UFormField :label="t('card.tags')">
            <USelectMenu
              v-model="form.tagIds"
              :items="props.tags"
              value-key="id"
              label-key="name"
              multiple
              :create-item="props.canEdit"
              :placeholder="t('card.noTags')"
              class="w-full"
              :disabled="!props.canEdit"
              @create="addTag"
            >
              <template v-if="selectedTags.length" #default>
                <span class="flex flex-wrap gap-1 min-w-0">
                  <TagChip v-for="tag in selectedTags" :key="tag.id" :tag="tag" />
                </span>
              </template>
              <template #item-leading="{ item }">
                <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
              </template>
              <template #create-item-label="{ item }">
                {{ t('card.createTag', { name: item }) }}
              </template>
              <template #empty>
                {{ t('card.noBoardTags') }}
              </template>
            </USelectMenu>
            <form
              v-if="props.canEdit && newTag"
              class="mt-2 p-3 rounded-md ring ring-default space-y-3"
              :aria-label="t('card.newTag')"
              @submit.prevent="confirmNewTag"
            >
              <div class="flex items-center gap-2">
                <span class="size-6 shrink-0 rounded-md ring ring-default" :style="{ backgroundColor: newTag.color }" />
                <UInput v-model="newTag.name" :maxlength="50" :aria-label="t('card.newTag')" class="flex-1" autofocus />
              </div>
              <div class="max-w-72">
                <ColorField v-model="newTag.color" />
              </div>
              <div class="flex justify-end gap-2">
                <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="newTag = null" />
                <UButton type="submit" icon="i-lucide-plus" :label="t('common.create')" :loading="creatingTag" :disabled="!newTag.name.trim()" />
              </div>
            </form>
            <div v-if="props.canEdit && selectedTags.length" class="flex flex-wrap gap-1 mt-2">
              <UPopover
                v-for="tag in selectedTags"
                :key="tag.id"
                :open="picking?.id === tag.id"
                @update:open="v => setPicking(tag, v)"
              >
                <button type="button" class="max-w-full rounded cursor-pointer" :aria-label="t('card.changeTagColour', { name: tag.name })">
                  <TagChip :tag="picking?.id === tag.id ? { ...tag, color: picking.color } : tag" />
                </button>
                <template #content>
                  <div v-if="picking" class="p-4 w-72">
                    <ColorField v-model="picking.color" />
                  </div>
                </template>
              </UPopover>
            </div>
            <template v-if="props.canEdit && selectedTags.length" #help>
              {{ t('card.tagColourHelp') }}
            </template>
          </UFormField>

          <UFormField :label="t('card.assignees')">
            <USelectMenu
              v-model="form.assigneeIds"
              :items="memberItems"
              value-key="value"
              multiple
              :placeholder="t('card.unassigned')"
              class="w-full"
              :disabled="!props.canEdit"
            />
            <template v-if="formerAssignees.length" #help>
              {{ t('card.formerAssignees', { count: formerAssignees.length }, formerAssignees.length) }}
              <UButton v-if="props.canEdit" size="xs" variant="link" :label="t('common.remove')" class="p-0" @click="form.assigneeIds = form.assigneeIds.filter(id => !formerAssignees.includes(id))" />
            </template>
          </UFormField>

          <UFormField v-if="!props.template" :label="t('card.startDate')" :error="datesInvalid ? t('card.startAfterDue') : undefined">
            <div class="flex gap-1">
              <UInput v-model="form.startDate" type="date" class="flex-1" :max="form.dueDate || undefined" :disabled="!props.canEdit" />
              <UTooltip v-if="props.canEdit && form.startDate" :text="t('card.clearStartDate')">
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  :aria-label="t('card.clearStartDate')"
                  @click="form.startDate = ''"
                />
              </UTooltip>
            </div>
          </UFormField>

          <UFormField v-if="!props.template" :label="t('card.dueDate')">
            <div class="flex gap-1">
              <UInput v-model="form.dueDate" type="date" class="flex-1" :disabled="!props.canEdit" />
              <UTooltip v-if="props.canEdit && form.dueDate" :text="t('card.clearDueDate')">
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  :aria-label="t('card.clearDueDate')"
                  @click="form.dueDate = ''"
                />
              </UTooltip>
            </div>
          </UFormField>

          <UFormField :label="t('card.priority')">
            <USelect v-model="form.priority" :items="priorityItems" class="w-full" :disabled="!props.canEdit" />
          </UFormField>

          <UFormField :label="t('card.estimate')" :error="estimateInvalid ? t('card.estimateInvalid') : undefined">
            <UInput
              v-model="form.estimate"
              type="number"
              min="0"
              max="9999"
              step="0.5"
              :placeholder="t('card.storyPoints')"
              class="w-full"
              :disabled="!props.canEdit"
            />
          </UFormField>

          <CardFields
            :fields="props.fields"
            :values="props.card.fields"
            :can-edit="props.canEdit"
            @set="(field, value) => emit('setField', field, value)"
          />

          <template v-if="props.canEdit">
            <UButton type="submit" form="card-form" block :label="t('common.save')" :disabled="!dirty || invalid" />
            <USeparator />
            <div class="flex flex-col gap-1">
              <template v-if="!props.template">
                <UButton color="neutral" variant="ghost" icon="i-lucide-copy-plus" :label="t('card.saveAsTemplate')" class="justify-start" @click="saveTemplate" />
                <UButton color="neutral" variant="ghost" icon="i-lucide-archive" :label="t('card.archive')" class="justify-start" @click="emit('archive'); open = false" />
              </template>
              <UButton color="error" variant="ghost" icon="i-lucide-trash" :label="t('common.delete')" class="justify-start" @click="emit('delete'); open = false" />
            </div>
          </template>
        </aside>
      </div>
    </template>
  </UModal>
</template>
