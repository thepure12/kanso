<script setup lang="ts">
import type { TimeEntry } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'

const props = defineProps<{ items: TimeEntry[] | null, total: number, canEdit: boolean, isOwner: boolean, cd: CardDetailApi }>()
const { user } = useUserSession()
const { t, locale } = useI18n()

// The form logs a new entry, or saves the one being edited.
const form = reactive({ duration: '', spentOn: isoDate(), note: '' })
const editingId = ref<string | null>(null)
const minutes = computed(() => parseDuration(form.duration))
const invalid = computed(() => !!form.duration.trim() && minutes.value === null)

function reset() {
  Object.assign(form, { duration: '', spentOn: isoDate(), note: '' })
  editingId.value = null
}

function edit(e: TimeEntry) {
  Object.assign(form, { duration: formatDuration(e.minutes, t), spentOn: e.spentOn, note: e.note })
  editingId.value = e.id
}

async function submit() {
  if (!minutes.value || !form.spentOn) return
  const entry = { minutes: minutes.value, spentOn: form.spentOn, note: form.note.trim() }
  const editing = props.items?.find(e => e.id === editingId.value)
  reset()
  if (editing) await props.cd.updateTimeEntry(editing, entry)
  else await props.cd.logTime(entry)
}

// Mirrors the time_entries policies; the server decides.
const mine = (e: TimeEntry) => e.userId === user.value?.id
const canDelete = (e: TimeEntry) => props.isOwner || (props.canEdit && mine(e))
</script>

<template>
  <section v-if="props.items && (props.items.length || props.canEdit)" class="space-y-2">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-timer" class="size-4 text-dimmed" />
      <h3 class="text-sm font-medium">
        {{ t('time.title') }}
      </h3>
      <span v-if="props.total" class="text-xs text-muted">{{ t('time.total', { duration: formatDuration(props.total, t) }) }}</span>
    </div>
    <form v-if="props.canEdit" class="flex flex-wrap items-start gap-2" @submit.prevent="submit">
      <UFormField :error="invalid ? t('time.invalid') : undefined" class="w-32">
        <UInput v-model="form.duration" :placeholder="t('time.durationPlaceholder')" size="sm" :aria-label="t('time.spent')" />
      </UFormField>
      <UInput v-model="form.spentOn" type="date" size="sm" class="w-40" :aria-label="t('time.date')" />
      <UInput v-model="form.note" :placeholder="t('time.notePlaceholder')" size="sm" class="flex-1 min-w-32" :maxlength="500" :aria-label="t('time.note')" />
      <UButton type="submit" size="sm" :label="editingId ? t('common.save') : t('time.log')" :disabled="!minutes || !form.spentOn" />
      <UButton v-if="editingId" size="sm" color="neutral" variant="ghost" :label="t('common.cancel')" @click="reset" />
    </form>
    <ul class="space-y-1">
      <li v-for="e in props.items" :key="e.id" class="group flex items-center gap-2 text-sm">
        <span class="font-medium w-16 shrink-0">{{ formatDuration(e.minutes, t) }}</span>
        <span class="text-xs text-muted shrink-0">{{ formatDate(e.spentOn, locale) }}</span>
        <span class="text-xs shrink-0">{{ e.userName ?? t('card.formerMember') }}</span>
        <span class="text-xs text-muted truncate">{{ e.note }}</span>
        <div class="ms-auto flex shrink-0">
          <UButton v-if="props.canEdit && mine(e)" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t('time.edit')" @click="edit(e)" />
          <UButton v-if="canDelete(e)" size="xs" color="error" variant="ghost" icon="i-lucide-trash" :aria-label="t('time.delete')" @click="props.cd.deleteTimeEntry(e)" />
        </div>
      </li>
    </ul>
  </section>
</template>
