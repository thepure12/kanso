<script setup lang="ts">
import { snoozePresets, type SnoozePreset } from '~/utils/snooze'

const emit = defineEmits<{ snooze: [until: string] }>()
const { t, locale } = useI18n()

const open = ref(false)
const today = ref(isoDate())
const custom = ref('')
watch(open, (isOpen) => {
  if (!isOpen) return
  today.value = isoDate()
  custom.value = ''
})
const presets = computed(() => {
  const dates = snoozePresets(today.value)
  const labels: Record<SnoozePreset, string> = {
    tomorrow: t('card.snoozeTomorrow'),
    nextWeek: t('card.snoozeNextWeek'),
    nextMonth: t('card.snoozeNextMonth'),
  }
  return (Object.keys(dates) as SnoozePreset[]).map(k => ({ key: k, label: labels[k], date: dates[k] }))
})
const minDate = computed(() => addDays(today.value, 1))

function pick(date: string) {
  if (!date || date < minDate.value) return
  open.value = false
  emit('snooze', date)
}
</script>

<template>
  <UPopover v-model:open="open">
    <UButton color="neutral" variant="ghost" icon="i-lucide-alarm-clock" :label="t('card.snooze')" class="justify-start" />
    <template #content>
      <div class="flex w-64 flex-col gap-1 p-2">
        <p class="px-1 pb-1 text-xs text-muted">
          {{ t('card.snoozeHint') }}
        </p>
        <UButton
          v-for="p in presets"
          :key="p.key"
          color="neutral"
          variant="ghost"
          class="justify-between"
          @click="pick(p.date)"
        >
          <span>{{ p.label }}</span>
          <span class="text-xs text-muted">{{ formatDate(p.date, locale) }}</span>
        </UButton>
        <USeparator class="my-1" />
        <form class="flex items-center gap-1" @submit.prevent="pick(custom)">
          <UInput v-model="custom" type="date" :min="minDate" class="flex-1" :aria-label="t('card.snoozePick')" />
          <UButton type="submit" :label="t('card.snooze')" :disabled="!custom || custom < minDate" />
        </form>
      </div>
    </template>
  </UPopover>
</template>
