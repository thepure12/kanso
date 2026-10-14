<script setup lang="ts">
import { recurrenceRules, type CardRecurrence, type Column, type RecurrenceInput, type RecurrenceRule } from '#shared/types/board'

const props = defineProps<{
  recurrence: CardRecurrence | null
  columns: Column[]
  /** Target column for a new schedule: the template's own column. */
  defaultColumnId: string
  canEdit: boolean
}>()
const emit = defineEmits<{
  save: [input: RecurrenceInput]
  remove: []
}>()

const { t, locale } = useI18n()
const i18n = useI18nContext()
const ruleItems = computed(() => recurrenceRules.map(r => ({ label: t(`recurrence.rule.${r}`), value: r })))
const weekdays = computed(() => weekdayLabels(locale.value))

const form = reactive({
  columnId: '',
  rule: 'weekly' as RecurrenceRule,
  interval: 1,
  weekdays: [] as number[],
  dayOfMonth: 1,
  // Text of the number input; empty = no due date.
  dueInDays: '',
  active: true,
})
// Reset from the saved schedule when it changes (saved here or by someone else).
watch(() => props.recurrence, (r) => {
  const today = new Date()
  Object.assign(form, {
    columnId: r?.columnId ?? props.defaultColumnId,
    rule: r?.rule ?? 'weekly',
    interval: r?.interval ?? 1,
    weekdays: r?.weekdays ? [...r.weekdays] : [today.getDay() || 7],
    dayOfMonth: r?.dayOfMonth ?? today.getDate(),
    dueInDays: r?.dueInDays?.toString() ?? '',
    active: r?.active ?? true,
  })
}, { immediate: true })

const columnItems = computed(() => props.columns.map(c => ({ label: c.title, value: c.id })))

const input = computed(() => {
  const due = String(form.dueInDays ?? '').trim()
  return recurrenceInput({
    columnId: form.columnId,
    rule: form.rule,
    interval: Number(form.interval),
    weekdays: form.weekdays,
    dayOfMonth: Number(form.dayOfMonth),
    dueInDays: due === '' ? null : Number(due),
    active: form.active,
  })
})

function toggleDay(day: number) {
  form.weekdays = form.weekdays.includes(day) ? form.weekdays.filter(d => d !== day) : [...form.weekdays, day]
}

function save() {
  if (input.value) emit('save', input.value)
}
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-center gap-2">
      <h3 class="text-sm font-medium flex items-center gap-1.5">
        <UIcon name="i-lucide-repeat" /> {{ t('recurrence.title') }}
      </h3>
      <UBadge v-if="props.recurrence && !props.recurrence.active" color="neutral" variant="subtle" size="sm" :label="t('recurrence.paused')" />
    </div>

    <p v-if="props.recurrence" class="text-sm text-muted">
      {{ describeRecurrence(props.recurrence, i18n) }}<template v-if="props.recurrence.active">
        · {{ t('recurrence.next', { date: formatDateTime(props.recurrence.nextRunAt, locale) }) }}
      </template>
    </p>
    <p v-else-if="!props.canEdit" class="text-sm text-muted">
      {{ t('recurrence.none') }}
    </p>

    <form v-if="props.canEdit" class="space-y-3" @submit.prevent="save">
      <div class="flex gap-2">
        <USelect v-model="form.rule" :items="ruleItems" class="flex-1" :aria-label="t('recurrence.title')" />
        <UInput v-model.number="form.interval" type="number" min="1" max="365" class="w-20" :aria-label="t('recurrence.interval')">
          <template #trailing>
            <span class="text-xs text-muted">{{ t(`recurrence.unit.${form.rule}`, { count: form.interval }, Number(form.interval) || 2) }}</span>
          </template>
        </UInput>
      </div>
      <div v-if="form.rule === 'weekly'" class="flex flex-wrap gap-1" role="group" :aria-label="t('recurrence.weekdays')">
        <UButton
          v-for="d in weekdays"
          :key="d.value"
          size="xs"
          :label="d.label"
          :color="form.weekdays.includes(d.value) ? 'primary' : 'neutral'"
          :variant="form.weekdays.includes(d.value) ? 'solid' : 'outline'"
          :aria-pressed="form.weekdays.includes(d.value)"
          @click="toggleDay(d.value)"
        />
      </div>
      <UFormField v-if="form.rule === 'monthly'" :label="t('recurrence.dayOfMonth')" :help="t('recurrence.dayOfMonthHelp')">
        <UInput v-model.number="form.dayOfMonth" type="number" min="1" max="31" class="w-full" />
      </UFormField>
      <UFormField :label="t('recurrence.column')">
        <USelect v-model="form.columnId" :items="columnItems" class="w-full" />
      </UFormField>
      <UFormField :label="t('recurrence.dueAfter')">
        <UInput v-model="form.dueInDays" type="number" min="0" max="365" :placeholder="t('recurrence.noDueDate')" class="w-full" />
      </UFormField>
      <USwitch v-if="props.recurrence" v-model="form.active" :label="t('recurrence.active')" />
      <div class="flex gap-2">
        <UButton type="submit" size="sm" :label="props.recurrence ? t('recurrence.save') : t('recurrence.title')" :disabled="!input" />
        <UButton v-if="props.recurrence" size="sm" color="error" variant="ghost" :label="t('recurrence.stop')" @click="emit('remove')" />
      </div>
    </form>
  </section>
</template>
