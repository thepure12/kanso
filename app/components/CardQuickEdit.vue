<script setup lang="ts">
import type { AvatarProps } from '@nuxt/ui'
import type { Card, CardPatch, Member, Tag } from '#shared/types/board'
import type { QuickEditMode } from '~/utils/shortcuts'

/**
 * Small picker opened by single-key shortcuts on a focused board card:
 * `d` due date, `t` card tags, `m` assignees. Tag and assignee picks toggle
 * at once (the dialog stays open); the due date is set or cleared and closes.
 */
const props = defineProps<{
  card: Card
  mode: QuickEditMode
  tags: Tag[]
  members: Member[]
}>()
const emit = defineEmits<{ update: [patch: CardPatch] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const title = computed(() => t(`card.quickEdit.${props.mode}`))

interface PickItem {
  id: string
  label: string
  selected: boolean
  onSelect: () => void
  color?: string
  avatar?: AvatarProps
  description?: string
}

function toggle(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
}

const groups = computed<{ id: string, items: PickItem[] }[]>(() => {
  if (props.mode === 'tags') {
    return [{
      id: 'tags',
      items: props.tags.map(tag => ({
        id: tag.id,
        label: tag.name,
        color: tag.color,
        selected: props.card.tagIds.includes(tag.id),
        onSelect: () => emit('update', { tagIds: toggle(props.card.tagIds, tag.id) }),
      })),
    }]
  }
  return [{
    id: 'assignees',
    items: props.members.map(m => ({
      id: m.userId,
      label: m.name,
      ...personItem(m, t('bots.badge')),
      selected: props.card.assigneeIds.includes(m.userId),
      onSelect: () => emit('update', { assigneeIds: toggle(props.card.assigneeIds, m.userId) }),
    })),
  }]
})

const due = ref(props.card.dueDate ?? '')
function setDue(value: string | null) {
  emit('update', { dueDate: value })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="props.card.title" :ui="{ body: props.mode === 'due' ? undefined : 'p-0 sm:p-0' }">
    <template #body>
      <form v-if="props.mode === 'due'" class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2" @submit.prevent="due && setDue(due)">
        <UInput v-model="due" type="date" autofocus :aria-label="title" class="flex-1" />
        <UButton type="submit" :label="t('board.bulk.set')" :disabled="!due" />
        <UButton v-if="props.card.dueDate" color="neutral" variant="outline" :label="t('board.bulk.clearDue')" @click="setDue(null)" />
      </form>
      <UCommandPalette
        v-else
        :groups="groups"
        :placeholder="t(props.mode === 'tags' ? 'card.quickEdit.searchTags' : 'card.quickEdit.searchPeople')"
        class="max-h-[60vh]"
      >
        <template #item-leading="{ item }">
          <span v-if="props.mode === 'tags'" class="size-3 shrink-0 rounded-full ring ring-inset ring-black/10" :style="{ backgroundColor: (item as PickItem).color }" />
          <UAvatar v-else v-bind="(item as PickItem).avatar" size="2xs" />
        </template>
        <template #item-trailing="{ item }">
          <UIcon v-if="(item as PickItem).selected" name="i-lucide-check" class="size-4 text-primary" :aria-label="t('card.quickEdit.selected')" />
        </template>
      </UCommandPalette>
    </template>
  </UModal>
</template>
