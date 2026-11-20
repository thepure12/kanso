<script setup lang="ts">
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { Checklist, Member } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'
import { CHECKLIST_NAME_MAX } from '#shared/cards'

/** A card's named checklists: drag to reorder them, items drag between them. */
const props = defineProps<{
  lists: Checklist[] | null
  canEdit: boolean
  cd: CardDetailApi
  /** Board members, offered as item assignees. */
  members?: Member[]
  /** Templates have no item assignees or due dates. */
  template?: boolean
}>()
const { t } = useI18n()

// One drag group per card, so items never land in another dialog's lists.
const group = computed(() => `checklist-items-${props.cd.cardId.value}`)

const lists = computed({
  get: () => props.lists ?? [],
  set: (v) => { if (props.cd.detail.value) props.cd.detail.value.checklists = v },
})

function onDrop(e: SortableEvent) {
  nextTick(() => props.cd.checklistMoved(e.newIndex!))
}
</script>

<template>
  <div v-if="props.lists && (props.lists.length || props.canEdit)" class="space-y-4">
    <!-- No checklist yet: adding an item creates one named "Checklist" (server). -->
    <section v-if="!props.lists.length" class="space-y-2">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-list-checks" class="size-4 text-dimmed" />
        <h3 class="text-sm font-medium">
          {{ t('checklist.title') }}
        </h3>
      </div>
      <InlineAdd :label="t('checklist.addItem')" :placeholder="t('checklist.itemPlaceholder')" @add="text => props.cd.addChecklistItem(text)" />
    </section>
    <VueDraggable
      v-else
      v-model="lists"
      :disabled="!props.canEdit"
      handle=".list-handle"
      :animation="150"
      class="space-y-4"
      @update="onDrop"
    >
      <CardChecklist v-for="list in lists" :key="list.id" :list="list" :can-edit="props.canEdit" :cd="props.cd" :group="group" :members="props.members" :template="props.template" />
    </VueDraggable>
    <InlineAdd
      v-if="props.canEdit"
      :label="t('checklist.addList')"
      :placeholder="t('checklist.namePlaceholder')"
      :maxlength="CHECKLIST_NAME_MAX"
      @add="name => props.cd.addChecklist(name)"
    />
  </div>
</template>
