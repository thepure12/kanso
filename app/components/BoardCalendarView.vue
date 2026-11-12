<script setup lang="ts">
import type { Card, CardPatch, Tag } from '#shared/types/board'

const props = defineProps<{
  /** Shown (filtered) cards in board order. */
  cards: Card[]
  tags: Tag[]
  canEdit: boolean
  today: string
}>()
const emit = defineEmits<{ 'open': [cardId: string], 'set-date': [card: Card, patch: CardPatch], 'dragging': [value: boolean] }>()

const { t, locale } = useI18n()
const mode = ref<CalendarMode>('due')
const modeItems = computed(() => [{ label: t('calendar.dueDate'), value: 'due' }, { label: t('calendar.startDate'), value: 'start' }])
const month = ref(monthOf(props.today))
const weeks = computed(() => monthGrid(month.value))
const weekdays = computed(() => weekdayNames(locale.value))
const byDate = computed(() => cardsByDate(props.cards, mode.value))
const undated = computed(() => byDate.value.get(null) ?? [])
const tagColor = (card: Card) => props.tags.find(t => card.tagIds.includes(t.id))?.color

// Drag and drop between days (native HTML drag events; editors only).
const draggingId = ref<string | null>(null)
const overDate = ref<string | null | undefined>(undefined)
function dragStart(card: Card, e: DragEvent) {
  draggingId.value = card.id
  e.dataTransfer?.setData('text/plain', card.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  emit('dragging', true)
}
function dragEnd() {
  draggingId.value = null
  overDate.value = undefined
  emit('dragging', false)
}
function dragOver(date: string | null, e: DragEvent) {
  if (!draggingId.value) return
  e.preventDefault()
  overDate.value = date
}
/** Drops the dragged card on a day, or with null on the "No date" tray (clears the date). */
function drop(date: string | null) {
  const card = props.cards.find(c => c.id === draggingId.value)
  dragEnd()
  if (!card || (mode.value === 'due' ? card.dueDate : card.startDate) === date) return
  emit('set-date', card, date ? moveDatePatch(card, mode.value, date) : mode.value === 'due' ? { dueDate: null } : { startDate: null })
}

const dayLabel = (date: string) => new Date(`${date}T00:00`).toLocaleDateString(locale.value, { dateStyle: 'full' })
</script>

<template>
  <div class="flex flex-col lg:flex-row gap-4 lg:items-stretch lg:min-h-full">
    <div class="flex-1 min-w-0 w-full flex flex-col">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <UTooltip :text="t('calendar.previous')">
          <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" :aria-label="t('calendar.previous')" @click="month = shiftMonth(month, -1)" />
        </UTooltip>
        <UTooltip :text="t('calendar.next')">
          <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" :aria-label="t('calendar.next')" @click="month = shiftMonth(month, 1)" />
        </UTooltip>
        <UButton color="neutral" variant="outline" :label="t('views.today')" @click="month = monthOf(props.today)" />
        <h2 class="text-lg font-semibold ms-1" aria-live="polite">
          {{ monthTitle(month, locale) }}
        </h2>
        <USelect v-model="mode" :items="modeItems" icon="i-lucide-calendar" class="w-36 ms-auto" :aria-label="t('calendar.placeBy')" />
      </div>
      <div
        class="flex-1 grid grid-cols-7 rounded-lg ring ring-default overflow-hidden"
        :style="{ gridTemplateRows: `auto repeat(${weeks.length}, minmax(7rem, 1fr))` }"
        role="grid"
        :aria-label="monthTitle(month, locale)"
      >
        <div v-for="name in weekdays" :key="name" class="px-2 py-1 text-xs font-medium text-muted bg-elevated/60 border-b border-default" role="columnheader">
          {{ name }}
        </div>
        <template v-for="week in weeks" :key="week[0]">
          <div
            v-for="date in week"
            :key="date"
            role="gridcell"
            :data-date="date"
            :aria-label="dayLabel(date)"
            class="p-1 border-b border-e border-default flex flex-col gap-1 min-w-0"
            :class="[
              monthOf(date) !== month && 'bg-elevated/30 text-dimmed',
              overDate === date && 'bg-primary/10',
            ]"
            @dragover="dragOver(date, $event)"
            @drop.prevent="drop(date)"
          >
            <span
              class="text-xs self-end size-6 grid place-items-center rounded-full"
              :class="date === props.today ? 'bg-primary text-inverted font-semibold' : ''"
            >{{ Number(date.slice(8)) }}</span>
            <UTooltip v-for="card in byDate.get(date) ?? []" :key="card.id" :text="card.title">
              <button
                type="button"
                :draggable="props.canEdit"
                :data-card="card.id"
                class="text-left text-xs rounded px-1.5 py-1 bg-default ring ring-default hover:ring-primary/50 truncate border-s-4"
                :class="[draggingId === card.id && 'opacity-40', props.canEdit && 'cursor-grab']"
                :style="{ borderInlineStartColor: tagColor(card) ?? 'var(--ui-border-accented)' }"
                @click="emit('open', card.id)"
                @dragstart="dragStart(card, $event)"
                @dragend="dragEnd"
              >
                {{ card.title }}
              </button>
            </UTooltip>
          </div>
        </template>
      </div>
    </div>
    <!-- On wide screens the tray takes the view's height and scrolls, instead of stretching it. -->
    <div class="w-full lg:w-64 shrink-0 lg:relative">
      <aside
        class="w-full lg:absolute lg:inset-0 rounded-lg ring ring-default p-3 flex flex-col gap-2"
        :class="overDate === null && 'bg-primary/10'"
        data-date="none"
        :aria-label="t('calendar.undatedLabel')"
        @dragover="dragOver(null, $event)"
        @drop.prevent="drop(null)"
      >
        <h3 class="text-sm font-medium">
          {{ t(mode === 'due' ? 'calendar.noDue' : 'calendar.noStart') }} <span class="text-muted font-normal">· {{ undated.length }}</span>
        </h3>
        <div class="flex flex-col gap-2 overflow-y-auto max-h-80 lg:max-h-none lg:flex-1 lg:min-h-0 -mx-1 px-1 py-0.5">
          <UTooltip v-for="card in undated" :key="card.id" :text="card.title">
            <button
              type="button"
              :draggable="props.canEdit"
              :data-card="card.id"
              class="shrink-0 text-left text-sm rounded px-2 py-1 bg-default ring ring-default hover:ring-primary/50 truncate border-s-4"
              :class="[draggingId === card.id && 'opacity-40', props.canEdit && 'cursor-grab']"
              :style="{ borderInlineStartColor: tagColor(card) ?? 'var(--ui-border-accented)' }"
              @click="emit('open', card.id)"
              @dragstart="dragStart(card, $event)"
              @dragend="dragEnd"
            >
              {{ card.title }}
            </button>
          </UTooltip>
        </div>
        <p v-if="props.canEdit" class="text-xs text-dimmed">
          {{ t('calendar.dragHint') }}
        </p>
      </aside>
    </div>
  </div>
</template>
