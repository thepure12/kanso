<script setup lang="ts">
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Checklist, ChecklistItem, Member } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'
import { CHECKLIST_NAME_MAX } from '#shared/cards'

/** One named checklist of a card. Items drag within it and between the card's checklists (`group`). */
const props = defineProps<{
  list: Checklist
  canEdit: boolean
  cd: CardDetailApi
  group: string
  /** Board members, offered as item assignees. */
  members?: Member[]
  /** Templates have no item assignees or due dates (copies leave them out). */
  template?: boolean
}>()
const { t, locale } = useI18n()
const confirm = useConfirm()
const today = isoDate()
const extras = computed(() => !props.template)

const memberOf = (id: string | null) => (id ? props.members?.find(m => m.userId === id) : undefined)

function assigneeItems(item: ChecklistItem): DropdownMenuItem[][] {
  const set = (assigneeId: string | null) => {
    if (assigneeId !== item.assigneeId) props.cd.updateChecklistItem(item, { assigneeId })
  }
  return [
    (props.members ?? []).map(m => ({
      label: m.name,
      avatar: { src: m.avatarUrl ?? undefined, alt: m.name },
      icon: m.userId === item.assigneeId ? 'i-lucide-check' : undefined,
      onSelect: () => set(m.userId),
    })),
    ...(item.assigneeId ? [[{ label: t('checklist.unassign'), icon: 'i-lucide-user-x', onSelect: () => set(null) }]] : []),
  ]
}

function setDue(item: ChecklistItem, value: string) {
  const dueDate = value || null
  if (dueDate !== item.dueDate) props.cd.updateChecklistItem(item, { dueDate })
}

const done = computed(() => props.list.items.filter(i => i.done).length)
const total = computed(() => props.list.items.length)

// v-model for drag and drop: the detail's own array of this checklist.
const items = computed({
  get: () => props.list.items,
  set: (v) => {
    const list = props.cd.detail.value?.checklists.find(l => l.id === props.list.id)
    if (list) list.items = v
  },
})

// Same list (update) or dropped in from another checklist (add); the source list needs nothing.
function onDrop(e: SortableEvent) {
  nextTick(() => {
    const list = props.cd.detail.value?.checklists.find(l => l.id === props.list.id)
    if (list) props.cd.checklistItemMoved(list, e.newIndex!)
  })
}

function rename(item: ChecklistItem, e: Event) {
  const input = e.target as HTMLInputElement
  const text = input.value.trim()
  if (!text) input.value = item.text
  else if (text !== item.text) props.cd.updateChecklistItem(item, { text })
}

function renameList(e: Event) {
  const input = e.target as HTMLInputElement
  const name = input.value.trim()
  if (!name) input.value = props.list.name
  else if (name !== props.list.name) props.cd.renameChecklist(props.list, name)
}

async function removeList() {
  if (total.value && !await confirm({ title: t('checklist.deleteListConfirm', { name: props.list.name }, total.value), confirmLabel: t('common.delete') })) return
  props.cd.deleteChecklist(props.list)
}
</script>

<template>
  <section class="space-y-2">
    <div class="group flex items-center gap-2">
      <UIcon v-if="props.canEdit" name="i-lucide-grip-vertical" class="list-handle size-4 cursor-grab text-dimmed shrink-0" />
      <UIcon v-else name="i-lucide-list-checks" class="size-4 text-dimmed shrink-0" />
      <input
        v-if="props.canEdit"
        :value="props.list.name"
        class="flex-1 min-w-0 bg-transparent text-sm font-medium rounded px-1 py-0.5 focus:outline-none focus:ring ring-primary"
        :maxlength="CHECKLIST_NAME_MAX"
        :aria-label="t('checklist.name')"
        @change="renameList"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      >
      <h3 v-else class="flex-1 min-w-0 truncate text-sm font-medium">
        {{ props.list.name }}
      </h3>
      <span v-if="total" class="text-xs text-muted">{{ done }}/{{ total }}</span>
      <UTooltip v-if="props.canEdit" :text="t('checklist.deleteList')">
        <UButton
          icon="i-lucide-trash-2"
          size="xs"
          color="neutral"
          variant="ghost"
          :aria-label="t('checklist.deleteList')"
          class="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100"
          @click="removeList"
        />
      </UTooltip>
    </div>
    <UProgress v-if="total" :model-value="done" :max="total" size="xs" :color="done === total ? 'success' : 'primary'" />
    <VueDraggable
      v-model="items"
      :disabled="!props.canEdit"
      :group="props.group"
      handle=".item-handle"
      :animation="150"
      class="space-y-1 min-h-1"
      @update="onDrop"
      @add="onDrop"
    >
      <div v-for="item in items" :key="item.id" class="group flex items-center gap-2">
        <UIcon v-if="props.canEdit" name="i-lucide-grip-vertical" class="item-handle size-4 cursor-grab text-dimmed shrink-0" />
        <UCheckbox
          :model-value="item.done"
          :disabled="!props.canEdit"
          :aria-label="item.done ? t('checklist.markNotDone', { text: item.text }) : t('checklist.markDone', { text: item.text })"
          @update:model-value="v => props.cd.updateChecklistItem(item, { done: !!v })"
        />
        <input
          v-if="props.canEdit"
          :value="item.text"
          class="flex-1 min-w-0 bg-transparent text-sm rounded px-1 py-0.5 focus:outline-none focus:ring ring-primary"
          :class="item.done && 'line-through text-muted'"
          maxlength="500"
          :aria-label="t('checklist.item', { text: item.text })"
          @change="rename(item, $event)"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        >
        <span v-else class="flex-1 text-sm" :class="item.done && 'line-through text-muted'">{{ item.text }}</span>
        <template v-if="extras">
          <UPopover v-if="props.canEdit">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :icon="item.dueDate ? undefined : 'i-lucide-calendar'"
              :label="item.dueDate ? formatDate(item.dueDate, locale) : undefined"
              :aria-label="item.dueDate ? t('checklist.dueOn', { date: formatDate(item.dueDate, locale) }) : t('checklist.setDue')"
              :class="[
                item.dueDate && !item.done && item.dueDate < today && 'text-error',
                !item.dueDate && 'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100',
              ]"
            />
            <template #content>
              <div class="flex items-center gap-2 p-2">
                <UInput
                  type="date"
                  size="sm"
                  :model-value="item.dueDate ?? ''"
                  :aria-label="t('checklist.dueDate')"
                  @change="setDue(item, ($event.target as HTMLInputElement).value)"
                />
                <UButton
                  v-if="item.dueDate"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="t('checklist.clearDue')"
                  @click="setDue(item, '')"
                />
              </div>
            </template>
          </UPopover>
          <span
            v-else-if="item.dueDate"
            class="text-xs shrink-0"
            :class="!item.done && item.dueDate < today ? 'text-error' : 'text-muted'"
          >{{ formatDate(item.dueDate, locale) }}</span>

          <UDropdownMenu v-if="props.canEdit" :items="assigneeItems(item)" :content="{ align: 'end' }">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :icon="item.assigneeId ? undefined : 'i-lucide-user-plus'"
              :aria-label="item.assigneeId ? t('checklist.assignedTo', { name: memberOf(item.assigneeId)?.name ?? t('common.someone') }) : t('checklist.assign')"
              :class="!item.assigneeId && 'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100'"
            >
              <UAvatar
                v-if="item.assigneeId"
                size="2xs"
                :src="memberOf(item.assigneeId)?.avatarUrl ?? undefined"
                :alt="memberOf(item.assigneeId)?.name ?? '?'"
              />
            </UButton>
          </UDropdownMenu>
          <UTooltip v-else-if="item.assigneeId" :text="memberOf(item.assigneeId)?.name ?? t('common.someone')">
            <UAvatar size="2xs" :src="memberOf(item.assigneeId)?.avatarUrl ?? undefined" :alt="memberOf(item.assigneeId)?.name ?? '?'" />
          </UTooltip>
        </template>
        <UTooltip v-if="props.canEdit" :text="t('checklist.deleteItem')">
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            :aria-label="t('checklist.deleteItem')"
            class="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100"
            @click="props.cd.deleteChecklistItem(item)"
          />
        </UTooltip>
      </div>
    </VueDraggable>
    <InlineAdd v-if="props.canEdit" :label="t('checklist.addItem')" :placeholder="t('checklist.itemPlaceholder')" @add="text => props.cd.addChecklistItem(text, props.list)" />
  </section>
</template>
