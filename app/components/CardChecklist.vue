<script setup lang="ts">
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { ChecklistItem } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'

const props = defineProps<{ items: ChecklistItem[] | null, canEdit: boolean, cd: CardDetailApi }>()
const { t } = useI18n()

const done = computed(() => props.items?.filter(i => i.done).length ?? 0)
const total = computed(() => props.items?.length ?? 0)

// v-model for drag and drop: the detail's own array.
const list = computed({
  get: () => props.items ?? [],
  set: (v) => { if (props.cd.detail.value) props.cd.detail.value.checklist = v },
})

function onDrop(e: SortableEvent) {
  nextTick(() => props.cd.checklistItemMoved(e.newIndex!))
}

function rename(item: ChecklistItem, e: Event) {
  const input = e.target as HTMLInputElement
  const text = input.value.trim()
  if (!text) input.value = item.text
  else if (text !== item.text) props.cd.updateChecklistItem(item, { text })
}
</script>

<template>
  <section v-if="props.items && (total || props.canEdit)" class="space-y-2">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-list-checks" class="size-4 text-dimmed" />
      <h3 class="text-sm font-medium">
        {{ t('checklist.title') }}
      </h3>
      <span v-if="total" class="text-xs text-muted">{{ done }}/{{ total }}</span>
    </div>
    <UProgress v-if="total" :model-value="done" :max="total" size="xs" :color="done === total ? 'success' : 'primary'" />
    <VueDraggable
      v-model="list"
      :disabled="!props.canEdit"
      handle=".item-handle"
      :animation="150"
      class="space-y-1"
      @update="onDrop"
    >
      <div v-for="item in list" :key="item.id" class="group flex items-center gap-2">
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
        <UTooltip v-if="props.canEdit" :text="t('checklist.deleteItem')">
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            :aria-label="t('checklist.deleteItem')"
            class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            @click="props.cd.deleteChecklistItem(item)"
          />
        </UTooltip>
      </div>
    </VueDraggable>
    <InlineAdd v-if="props.canEdit" :label="t('checklist.addItem')" :placeholder="t('checklist.itemPlaceholder')" @add="props.cd.addChecklistItem" />
  </section>
</template>
