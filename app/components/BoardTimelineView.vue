<script setup lang="ts">
import type { Card, Column } from '#shared/types/board'

const props = defineProps<{
  /** Shown (filtered) cards in board order. */
  cards: Card[]
  columns: Column[]
  today: string
}>()
const emit = defineEmits<{ open: [cardId: string] }>()

const { t, locale } = useI18n()
const i18n = useI18nContext()
const zoom = ref<TimelineZoom>('week')
const zoomItems = computed(() => [{ label: t('timeline.week'), value: 'week' }, { label: t('timeline.month'), value: 'month' }])
const dayWidth = computed(() => timelineDayWidth[zoom.value])

const scheduled = computed(() => props.cards.filter(isScheduled))
const range = computed(() => timelineRange(scheduled.value, props.today))
const months = computed(() => timelineMonths(range.value.start, range.value.days, locale.value))
const days = computed(() => Array.from({ length: range.value.days }, (_, i) => addDays(range.value.start, i)))
const todayOffset = computed(() => daysBetween(range.value.start, props.today))
/** Rows grouped by column, columns without scheduled cards left out. */
const groups = computed(() => props.columns
  .map(col => ({ col, cards: scheduled.value.filter(c => c.columnId === col.id) }))
  .filter(g => g.cards.length))
const width = computed(() => range.value.days * dayWidth.value)

const scroller = useTemplateRef<HTMLElement>('scroller')
function scrollToToday() {
  if (scroller.value) scroller.value.scrollLeft = Math.max(0, todayOffset.value * dayWidth.value - 160)
}
onMounted(scrollToToday)
watch(zoom, () => nextTick(scrollToToday))

const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00`).getDay())
</script>

<template>
  <div class="flex flex-col gap-3 max-h-full">
    <div class="flex flex-wrap items-center gap-2">
      <USelect v-model="zoom" :items="zoomItems" icon="i-lucide-zoom-in" class="w-32" :aria-label="t('timeline.zoom')" />
      <UButton color="neutral" variant="outline" :label="t('views.today')" @click="scrollToToday" />
      <span class="text-sm text-muted">
        {{ t('timeline.scheduled', { scheduled: scheduled.length, total: props.cards.length }, props.cards.length) }}
      </span>
    </div>
    <!-- Grows with the rows up to the window height, then scrolls; the date header stays on top. -->
    <div v-if="groups.length" ref="scroller" class="min-h-0 overflow-auto rounded-lg ring ring-default">
      <div class="relative" :style="{ width: `calc(14rem + ${width}px)` }">
        <!-- Header: months, then days (week zoom) or week starts (month zoom). -->
        <div class="flex sticky top-0 z-10 bg-default border-b border-default">
          <div class="w-56 shrink-0 sticky left-0 z-20 bg-default border-e border-default" />
          <div class="relative" :style="{ width: `${width}px` }">
            <div class="relative h-6 border-b border-default">
              <span
                v-for="m in months"
                :key="m.offset"
                class="absolute top-0 h-full px-1 text-xs font-medium truncate border-s border-default"
                :style="{ left: `${m.offset * dayWidth}px`, width: `${m.length * dayWidth}px` }"
              >{{ m.label }}</span>
            </div>
            <div class="relative h-6">
              <template v-for="(d, i) in days" :key="d">
                <span
                  v-if="zoom === 'week' || i % 7 === 0"
                  class="absolute top-0 h-full text-[10px] text-muted grid place-items-center"
                  :class="zoom === 'week' && isWeekend(d) && 'text-dimmed'"
                  :style="{ left: `${i * dayWidth}px`, width: `${(zoom === 'week' ? 1 : 7) * dayWidth}px` }"
                >{{ Number(d.slice(8)) }}</span>
              </template>
            </div>
          </div>
        </div>

        <template v-for="g in groups" :key="g.col.id">
          <div class="flex bg-elevated/60 border-b border-default">
            <div class="w-56 shrink-0 sticky left-0 z-[5] px-3 py-1 text-sm font-medium truncate bg-elevated border-e border-default">
              {{ g.col.title }}
            </div>
            <div :style="{ width: `${width}px` }" />
          </div>
          <div v-for="card in g.cards" :key="card.id" class="flex border-b border-default last:border-b-0">
            <button
              type="button"
              class="w-56 shrink-0 sticky left-0 z-[5] px-3 py-1.5 text-sm text-left truncate bg-default border-e border-default hover:underline"
              :title="card.title"
              @click="emit('open', card.id)"
            >
              {{ card.title }}
            </button>
            <div class="relative h-9" :style="{ width: `${width}px` }">
              <template v-for="bar in [timelineBar(card, range.start)!]" :key="card.id">
                <button
                  type="button"
                  class="absolute top-1.5 h-6 text-[11px] font-medium truncate px-1.5 hover:brightness-110"
                  :class="bar.marker ? 'rounded-full' : 'rounded'"
                  :style="{
                    left: `${bar.offset * dayWidth}px`,
                    width: `${Math.max(bar.length * dayWidth, 12)}px`,
                    backgroundColor: g.col.color ?? 'var(--ui-primary)',
                    color: g.col.color ? contrastText(g.col.color) : 'var(--ui-bg)',
                  }"
                  :title="`${card.title}: ${formatDateRange(card.startDate, card.dueDate, i18n)}`"
                  :aria-label="`${card.title}: ${formatDateRange(card.startDate, card.dueDate, i18n)}`"
                  @click="emit('open', card.id)"
                >
                  <span v-if="!bar.marker && bar.length * dayWidth > 48">{{ card.title }}</span>
                </button>
              </template>
            </div>
          </div>
        </template>

        <div
          class="absolute top-0 bottom-0 w-0.5 bg-error/70 pointer-events-none z-[6]"
          :style="{ left: `calc(14rem + ${(todayOffset + 0.5) * dayWidth}px)` }"
          aria-hidden="true"
        />
      </div>
    </div>
    <p v-else class="text-sm text-muted text-center py-8">
      {{ t('timeline.empty') }}
    </p>
  </div>
</template>
