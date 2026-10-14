<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { BoardField, Card, Column, Member, Tag } from '#shared/types/board'

const props = defineProps<{
  /** Shown (filtered) cards in board order. */
  cards: Card[]
  columns: Column[]
  members: Member[]
  tags: Tag[]
  fields: BoardField[]
  canEdit: boolean
  today: string
}>()
const emit = defineEmits<{ open: [cardId: string], move: [card: Card, columnId: string] }>()

const UButton = resolveComponent('UButton')
const { t, locale } = useI18n()
const i18n = useI18nContext()

const sort = ref<CardSort | null>(null)
/** Ascending, then descending, then board order. */
function toggleSort(key: CardSortKey) {
  if (sort.value?.key !== key) sort.value = { key, desc: false }
  else if (!sort.value.desc) sort.value = { key, desc: true }
  else sort.value = null
}

function sortHeader(label: string, key: CardSortKey) {
  return () => {
    const active = sort.value?.key === key
    return h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      size: 'xs',
      label,
      class: '-mx-2',
      trailingIcon: active ? (sort.value!.desc ? 'i-lucide-arrow-down-wide-narrow' : 'i-lucide-arrow-up-narrow-wide') : 'i-lucide-arrow-up-down',
      'aria-label': active ? t(sort.value!.desc ? 'listView.sortedDesc' : 'listView.sortedAsc', { column: label }) : t('listView.sortBy', { column: label }),
      onClick: () => toggleSort(key),
    })
  }
}

const shownFields = computed(() => props.fields.filter(f => f.showOnCard))

const tableColumns = computed<TableColumn<Card>[]>(() => [
  { id: 'title', header: sortHeader(t('listView.title'), 'title') },
  { id: 'column', header: sortHeader(t('listView.status'), 'column') },
  { id: 'assignees', header: sortHeader(t('listView.assignees'), 'assignees') },
  { id: 'tags', header: sortHeader(t('listView.tags'), 'tags') },
  { id: 'priority', header: sortHeader(t('listView.priority'), 'priority') },
  { id: 'start', header: sortHeader(t('listView.start'), 'start'), cell: ({ row }) => row.original.startDate ? formatDate(row.original.startDate, locale.value) : '' },
  { id: 'due', header: sortHeader(t('listView.due'), 'due') },
  { id: 'estimate', header: sortHeader(t('listView.estimate'), 'estimate'), cell: ({ row }) => row.original.estimate === null ? '' : row.original.estimate.toLocaleString(locale.value, { maximumFractionDigits: 2 }) },
  { id: 'time', header: sortHeader(t('listView.time'), 'time'), cell: ({ row }) => row.original.timeMinutes ? formatDuration(row.original.timeMinutes, t) : '' },
  ...shownFields.value.map((f): TableColumn<Card> => ({
    id: `field:${f.id}`,
    header: sortHeader(f.name, `field:${f.id}`),
    cell: ({ row }) => formatFieldValue(f, row.original.fields[f.id], i18n) ?? '',
  })),
])

// Grouping: the column (status) or a swimlane grouping.
const groupBy = ref<'column' | GroupBy>('none')
const groupItems = computed(() => [
  { label: t('swimlanes.none'), value: 'none' },
  { label: t('listView.status'), value: 'column' },
  ...groupByItems(props.fields, t).slice(1),
])
watch(() => props.fields, (list) => {
  if (groupBy.value !== 'column' && !isValidGroupBy(groupBy.value, list)) groupBy.value = 'none'
}, { deep: true })

const groups = computed(() => {
  const ctx = { columns: props.columns, members: props.members, tags: props.tags, fields: props.fields }
  const sorted = sortCards(props.cards, sort.value, ctx)
  const by = groupBy.value
  if (by === 'none') return [{ key: 'all', label: '', cards: sorted }]
  if (by === 'column') {
    return props.columns.map(c => ({ key: c.id, label: c.title, cards: sorted.filter(card => card.columnId === c.id) }))
      .filter(g => g.cards.length)
  }
  return buildLanes(sorted, by, ctx, t)
    .map(l => ({ key: l.key, label: l.label, cards: sorted.filter(card => laneKeysOf(card, by, ctx).includes(l.key)) }))
    .filter(g => g.cards.length)
})

const columnItems = computed(() => props.columns.map(c => ({ label: c.title, value: c.id })))
const columnTitle = (id: string) => props.columns.find(c => c.id === id)?.title ?? ''
const cardTags = (card: Card) => props.tags.filter(t => card.tagIds.includes(t.id))
const assignees = (card: Card) => props.members.filter(m => card.assigneeIds.includes(m.userId))
const dueClass = (card: Card) => {
  const s = dueStatus(card.dueDate, props.today)
  return s === 'overdue' ? 'text-error font-medium' : s === 'today' || s === 'soon' ? 'text-warning' : ''
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-2">
      <USelect v-model="groupBy" :items="groupItems" icon="i-lucide-rows-3" class="w-44" :aria-label="t('listView.groupBy')" />
      <span class="text-sm text-muted">{{ t('listView.cardCount', { n: props.cards.length }, props.cards.length) }}</span>
    </div>
    <section v-for="g in groups" :key="g.key" class="rounded-lg ring ring-default overflow-hidden">
      <h3 v-if="g.label" class="px-4 py-2 text-sm font-medium bg-elevated/60 border-b border-default">
        {{ g.label }} <span class="text-muted font-normal">· {{ g.cards.length }}</span>
      </h3>
      <UTable :data="g.cards" :columns="tableColumns" :empty="t('listView.noCards')" :ui="{ td: 'py-2' }">
        <template #title-cell="{ row }">
          <button type="button" class="text-left font-medium hover:underline focus-visible:underline max-w-80 truncate block" @click="emit('open', row.original.id)">
            {{ row.original.title }}
          </button>
        </template>
        <template #column-cell="{ row }">
          <USelect
            v-if="props.canEdit"
            :model-value="row.original.columnId"
            :items="columnItems"
            size="xs"
            class="w-36"
            :aria-label="t('listView.statusOf', { title: row.original.title })"
            @update:model-value="(v: string) => v !== row.original.columnId && emit('move', row.original, v)"
          />
          <span v-else>{{ columnTitle(row.original.columnId) }}</span>
        </template>
        <template #assignees-cell="{ row }">
          <div v-if="assignees(row.original).length" class="flex items-center gap-1.5">
            <UAvatarGroup :max="3" size="2xs">
              <UAvatar v-for="m in assignees(row.original)" :key="m.userId" :src="m.avatarUrl ?? undefined" :alt="m.name" />
            </UAvatarGroup>
            <span class="truncate max-w-40">{{ assignees(row.original).map(m => m.name).join(', ') }}</span>
          </div>
        </template>
        <template #tags-cell="{ row }">
          <div class="flex flex-wrap gap-1 max-w-56">
            <TagChip v-for="t in cardTags(row.original)" :key="t.id" :tag="t" />
          </div>
        </template>
        <template #priority-cell="{ row }">
          <UBadge
            v-if="row.original.priority"
            :color="priorityMeta[row.original.priority].color"
            variant="subtle"
            size="sm"
            :icon="priorityMeta[row.original.priority].icon"
            :label="t(`priority.${row.original.priority}`)"
          />
        </template>
        <template #due-cell="{ row }">
          <span v-if="row.original.dueDate" :class="dueClass(row.original)">{{ formatDate(row.original.dueDate, locale) }}</span>
        </template>
      </UTable>
    </section>
    <p v-if="!groups.length" class="text-sm text-muted text-center py-8">
      {{ t('listView.empty') }}
    </p>
  </div>
</template>
