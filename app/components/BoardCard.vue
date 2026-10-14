<script setup lang="ts">
import type { BoardField, Card, Member, Tag } from '#shared/types/board'

const props = withDefaults(defineProps<{
  card: Card
  tags: Tag[]
  /** The board's fields; values of those shown on cards appear as chips. */
  fields?: BoardField[]
  members: Member[]
  canEdit: boolean
  today: string
  /** Some card that blocks this one is still open (see blockedCardIds). */
  blocked?: boolean
  /** Picked for a bulk action. */
  selected?: boolean
  /** Some card is selected: a click toggles selection instead of opening the card. */
  selecting?: boolean
}>(), { fields: () => [] })
const emit = defineEmits<{ open: [], delete: [], select: [] }>()
const { t, locale } = useI18n()
const i18n = useI18nContext()

/** The card's tags in board tag order (alphabetical). */
const cardTags = computed(() => props.tags.filter(t => props.card.tagIds.includes(t.id)))
const assignees = computed(() => props.members.filter(m => props.card.assigneeIds.includes(m.userId)))
const due = computed(() => dueStatus(props.card.dueDate, props.today))
const dueColor = computed(() => ({ overdue: 'error', today: 'warning', soon: 'warning', later: 'neutral' } as const)[due.value ?? 'later'])
const checklistDone = computed(() => props.card.checklist.total > 0 && props.card.checklist.done === props.card.checklist.total)
const hasMeta = computed(() => {
  const c = props.card
  return !!(c.description || c.startDate || c.dueDate || c.priority || c.estimate !== null || c.checklist.total
    || c.commentCount || c.attachmentCount || c.timeMinutes || c.assigneeIds.length || c.watching || props.blocked)
})
// Unticked checkboxes are left out like empty values.
const fieldChips = computed(() => props.fields.flatMap((f) => {
  const value = props.card.fields[f.id]
  const text = f.showOnCard && value !== false ? formatFieldValue(f, value, i18n) : null
  if (text === null) return []
  const color = f.kind === 'select' ? f.options.find(o => o.id === value)?.color : undefined
  return [{ id: f.id, kind: f.kind, name: f.name, text, color }]
}))
/** Ctrl/Cmd/Shift+click (or any click while selecting) toggles selection; editors only. */
function onClick(e: MouseEvent | KeyboardEvent) {
  if (props.canEdit && (props.selecting || e.ctrlKey || e.metaKey || e.shiftKey)) emit('select')
  else emit('open')
}
const dateLabel = computed(() => formatDateRange(props.card.startDate, props.card.dueDate, i18n))
const dueAriaLabel = computed(() => {
  const c = props.card
  if (!c.dueDate) return ''
  const date = formatDate(c.dueDate, locale.value)
  const label = c.startDate ? t('boardCard.startsDue', { start: formatDate(c.startDate, locale.value), due: date }) : t('boardCard.due', { due: date })
  return due.value === 'overdue' ? t('boardCard.overdue', { label }) : label
})
</script>

<template>
  <UCard
    :ui="{ body: 'p-3 sm:p-3' }"
    class="group relative cursor-pointer hover:ring-primary/50 transition"
    :class="props.selected && 'ring-2 ring-primary bg-primary/5'"
    tabindex="0"
    @click="onClick"
    @keydown.enter="onClick"
  >
    <UButton
      v-if="props.canEdit"
      :icon="props.selected ? 'i-lucide-square-check' : 'i-lucide-square'"
      size="xs"
      color="neutral"
      variant="ghost"
      :aria-label="t(props.selected ? 'boardCard.deselect' : 'boardCard.select')"
      :aria-pressed="props.selected"
      class="absolute z-10 top-1 right-7 transition"
      :class="props.selected || props.selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'"
      @click.stop="emit('select')"
    />
    <UButton
      v-if="props.canEdit"
      icon="i-lucide-x"
      size="xs"
      color="neutral"
      variant="ghost"
      :aria-label="t('boardCard.delete')"
      class="absolute z-10 top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
      @click.stop="emit('delete')"
    />
    <img
      v-if="props.card.coverAttachmentId"
      :src="`/api/attachments/${props.card.coverAttachmentId}`"
      alt=""
      loading="lazy"
      class="-mx-3 -mt-3 mb-2 h-32 w-[calc(100%+1.5rem)] max-w-none object-cover rounded-t-lg"
    >
    <div v-if="cardTags.length" class="flex flex-wrap gap-1 mb-2" :class="props.canEdit && 'pe-12'">
      <TagChip v-for="t in cardTags" :key="t.id" :tag="t" />
    </div>
    <p class="text-sm font-medium break-words" :class="props.canEdit && 'pe-12'">
      {{ props.card.title }}
    </p>
    <div v-if="fieldChips.length" class="flex flex-wrap gap-1 mt-2">
      <template v-for="chip in fieldChips" :key="chip.id">
        <span
          v-if="chip.color"
          class="inline-flex items-center max-w-full rounded px-1.5 py-0.5 text-xs font-medium truncate"
          :style="{ backgroundColor: chip.color, color: contrastText(chip.color) }"
          :title="`${chip.name}: ${chip.text}`"
        >
          {{ chip.text }}
        </span>
        <UBadge
          v-else-if="chip.kind === 'checkbox'"
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-check"
          :label="chip.name"
          class="max-w-full"
        />
        <UBadge
          v-else
          color="neutral"
          variant="outline"
          size="sm"
          :label="`${chip.name}: ${chip.text}`"
          :title="`${chip.name}: ${chip.text}`"
          class="max-w-full truncate"
        />
      </template>
    </div>
    <div v-if="hasMeta" class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-xs text-dimmed">
      <UBadge v-if="props.blocked" color="error" variant="subtle" size="sm" icon="i-lucide-ban" :label="t('boardCard.blocked')" />
      <UBadge
        v-if="props.card.priority"
        :color="priorityMeta[props.card.priority].color"
        variant="subtle"
        size="sm"
        :icon="priorityMeta[props.card.priority].icon"
        :label="t(`priority.${props.card.priority}`)"
      />
      <UBadge
        v-if="props.card.dueDate"
        :color="dueColor"
        :variant="due === 'overdue' ? 'solid' : 'subtle'"
        size="sm"
        icon="i-lucide-calendar"
        :label="dateLabel"
        :aria-label="dueAriaLabel"
      />
      <UBadge
        v-else-if="props.card.startDate"
        color="neutral"
        variant="subtle"
        size="sm"
        icon="i-lucide-calendar"
        :label="dateLabel"
        :aria-label="t('boardCard.starts', { start: formatDate(props.card.startDate, locale) })"
      />
      <UBadge
        v-if="props.card.estimate !== null"
        color="neutral"
        variant="outline"
        size="sm"
        :label="props.card.estimate.toLocaleString(locale, { maximumFractionDigits: 2 })"
        :aria-label="t('boardCard.estimate', { points: formatPoints(props.card.estimate, i18n) })"
      />
      <UIcon v-if="props.card.watching" name="i-lucide-eye" class="size-4" :aria-label="t('boardCard.watching')" />
      <UIcon v-if="props.card.description" name="i-lucide-align-left" class="size-4" :aria-label="t('boardCard.hasDescription')" />
      <span v-if="props.card.checklist.total" class="inline-flex items-center gap-0.5" :class="checklistDone && 'text-success'">
        <UIcon name="i-lucide-square-check" class="size-4" />
        {{ props.card.checklist.done }}/{{ props.card.checklist.total }}
      </span>
      <span v-if="props.card.commentCount" class="inline-flex items-center gap-0.5">
        <UIcon name="i-lucide-message-square" class="size-4" />
        {{ props.card.commentCount }}
      </span>
      <span v-if="props.card.attachmentCount" class="inline-flex items-center gap-0.5">
        <UIcon name="i-lucide-paperclip" class="size-4" />
        {{ props.card.attachmentCount }}
      </span>
      <span v-if="props.card.timeMinutes" class="inline-flex items-center gap-0.5" :aria-label="t('boardCard.timeLogged', { time: formatDuration(props.card.timeMinutes, t) })">
        <UIcon name="i-lucide-timer" class="size-4" />
        {{ formatDuration(props.card.timeMinutes, t) }}
      </span>
      <UAvatarGroup v-if="assignees.length" :max="3" size="2xs" class="ms-auto">
        <UAvatar v-for="m in assignees" :key="m.userId" :src="m.avatarUrl ?? undefined" :alt="m.name" />
      </UAvatarGroup>
    </div>
  </UCard>
</template>
