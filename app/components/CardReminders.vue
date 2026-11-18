<script setup lang="ts">
import type { CardReminder } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'

/**
 * "Remind me" button with a popover: the current user's reminders on the card
 * (personal, like watching) and a form for a new one, at a time or relative to
 * the due date. The cards:reminders task turns due ones into notifications.
 */
const props = defineProps<{ items: CardReminder[], dueDate: string | null, cd: CardDetailApi }>()
const { t, locale } = useI18n()

const open = ref(false)
const mode = ref<'at' | 'due'>('at')
const form = reactive({ at: toLocalInput(reminderPresets().tomorrowMorning), days: 1, time: '09:00', note: '' })
const saving = ref(false)

const pending = computed(() => pendingReminders(props.items))
const modeItems = computed(() => [
  { label: t('reminders.atTime'), value: 'at' },
  { label: t('reminders.beforeDue'), value: 'due' },
])
const dayItems = computed(() => [0, 1, 2, 3, 7, 14].map(n => ({
  label: n === 0 ? t('reminders.dayOption') : t('reminders.daysOption', { n }, n),
  value: n,
})))

const atDate = computed(() => form.at ? new Date(form.at) : null)
const atInPast = computed(() => !!atDate.value && atDate.value.getTime() <= Date.now())
const canAdd = computed(() => !saving.value && (mode.value === 'due' ? /^\d{2}:\d{2}$/.test(form.time) : !!atDate.value && !atInPast.value))

const dateTime = (d: Date) => d.toLocaleString(locale.value, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function label(r: CardReminder): string {
  if (r.beforeDueDays === null) return r.remindAt ? dateTime(new Date(r.remindAt)) : ''
  const [h, m] = (r.dueTime ?? '0:0').split(':').map(Number)
  const time = new Date(2000, 0, 1, h, m).toLocaleTimeString(locale.value, { hour: 'numeric', minute: '2-digit' })
  return r.beforeDueDays === 0 ? t('reminders.onDueAt', { time }) : t('reminders.beforeDueAt', { n: r.beforeDueDays, time }, r.beforeDueDays)
}

/** The local date a due-date reminder lands on, from the card's current due date. */
function dueHint(r: CardReminder): string | null {
  if (r.beforeDueDays === null || !props.dueDate || !r.dueTime) return null
  return dateTime(dueReminderDate(props.dueDate, r.beforeDueDays, r.dueTime))
}

function preset(d: Date) {
  mode.value = 'at'
  form.at = toLocalInput(d)
}

async function add() {
  if (!canAdd.value) return
  saving.value = true
  const note = form.note.trim() || null
  const before = props.items.length
  try {
    await props.cd.addReminder(mode.value === 'at'
      ? { at: atDate.value!.toISOString(), note }
      : { beforeDueDays: form.days, time: form.time, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, note })
  }
  finally { saving.value = false }
  if (props.items.length > before) form.note = ''
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'start' }">
    <UTooltip :text="t('reminders.button')">
      <UButton
        icon="i-lucide-alarm-clock"
        :label="pending.length ? String(pending.length) : undefined"
        :aria-label="pending.length ? `${t('reminders.button')} (${t('reminders.count', { count: pending.length }, pending.length)})` : t('reminders.button')"
        :color="pending.length ? 'primary' : 'neutral'"
        variant="outline"
        size="sm"
      />
    </UTooltip>
    <template #content>
      <div class="w-80 max-w-[calc(100vw-2rem)] p-3 space-y-3">
        <p class="text-xs text-muted">
          {{ t('reminders.private') }}
        </p>
        <ul v-if="props.items.length" class="space-y-1">
          <li v-for="r in props.items" :key="r.id" class="flex items-start gap-2 text-sm">
            <UIcon name="i-lucide-alarm-clock" class="size-4 mt-0.5 shrink-0 text-dimmed" />
            <div class="min-w-0 flex-1">
              <p :class="r.sentAt ? 'text-muted' : ''">
                {{ label(r) }}
                <UBadge v-if="r.sentAt" :label="t('reminders.sent')" size="sm" color="neutral" variant="subtle" />
              </p>
              <p v-if="dueHint(r)" class="text-xs text-muted">
                {{ dueHint(r) }}
              </p>
              <p v-if="r.note" class="text-xs text-muted break-words">
                {{ r.note }}
              </p>
            </div>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="t('reminders.delete')"
              @click="props.cd.deleteReminder(r)"
            />
          </li>
        </ul>
        <form class="space-y-2" @submit.prevent="add">
          <UTabs v-model="mode" :items="modeItems" :content="false" size="xs" class="w-full" />
          <template v-if="mode === 'at'">
            <div class="flex gap-1">
              <UButton size="xs" color="neutral" variant="soft" :label="t('reminders.inOneHour')" @click="preset(reminderPresets().inOneHour)" />
              <UButton size="xs" color="neutral" variant="soft" :label="t('reminders.tomorrowMorning')" @click="preset(reminderPresets().tomorrowMorning)" />
            </div>
            <UInput v-model="form.at" type="datetime-local" size="sm" class="w-full" :aria-label="t('reminders.when')" :color="atInPast ? 'error' : undefined" :highlight="atInPast" />
          </template>
          <template v-else>
            <div class="flex gap-2">
              <USelect v-model="form.days" :items="dayItems" size="sm" class="flex-1" :aria-label="t('reminders.days')" />
              <UInput v-model="form.time" type="time" size="sm" class="w-28" :aria-label="t('reminders.time')" />
            </div>
            <p v-if="!props.dueDate" class="text-xs text-muted">
              {{ t('reminders.noDueDate') }}
            </p>
          </template>
          <UInput v-model="form.note" size="sm" class="w-full" :maxlength="500" :placeholder="t('reminders.notePlaceholder')" :aria-label="t('reminders.note')" />
          <UButton type="submit" size="sm" icon="i-lucide-plus" :label="t('reminders.add')" :loading="saving" :disabled="!canAdd" block />
        </form>
      </div>
    </template>
  </UPopover>
</template>
