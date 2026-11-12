<script setup lang="ts">
import { boardAutomationKinds, priorities, type BoardAutomation, type BoardAutomationKind, type NewBoardAutomation, type Priority, type Tag } from '#shared/types/board'

const props = defineProps<{ automations: BoardAutomation[], tags: Tag[], canEdit: boolean }>()
const emit = defineEmits<{
  add: [automation: NewBoardAutomation]
  update: [automation: BoardAutomation, patch: { active: boolean }]
  delete: [automation: BoardAutomation]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t, locale } = useI18n()

const tagById = computed(() => new Map(props.tags.map(tag => [tag.id, tag])))

const icons: Record<BoardAutomationKind, string> = {
  archive_done: 'i-lucide-archive',
  tag_stale: 'i-lucide-tag',
  notify_stale: 'i-lucide-bell',
  raise_priority: 'i-lucide-arrow-up-circle',
}

function describe(a: BoardAutomation | NewBoardAutomation) {
  // raise_priority has three forms: due today, within a day, within {n} days.
  if (a.kind === 'raise_priority') return t('automations.text.raise_priority', { n: a.days, priority: t(`priority.${a.priority}`) }, a.days)
  return t(`automations.text.${a.kind}`, { n: a.days }, a.days)
}

const kindItems = computed(() => boardAutomationKinds.map(k => ({ label: t(`automations.kinds.${k}`), value: k, icon: icons[k] })))
const priorityItems = computed(() => priorities.map(p => ({ label: t(`priority.${p}`), value: p })))

const defaults = () => ({ kind: 'archive_done' as BoardAutomationKind, days: 7, tagId: undefined as string | undefined, priority: 'high' as Priority })
const draft = reactive(defaults())
watch(open, (isOpen) => {
  if (isOpen) Object.assign(draft, defaults())
})

const minDays = computed(() => draft.kind === 'raise_priority' ? 0 : 1)
const valid = computed(() => draft.days >= minDays.value && draft.days <= 365 && (draft.kind !== 'tag_stale' || !!draft.tagId))

function add() {
  if (!valid.value) return
  const { kind, days } = draft
  emit('add', kind === 'tag_stale'
    ? { kind, days, tagId: draft.tagId! }
    : kind === 'raise_priority' ? { kind, days, priority: draft.priority } : { kind, days })
}
</script>

<template>
  <UModal v-model:open="open" :title="t('automations.title')" :description="t('automations.description')">
    <template #body>
      <div class="space-y-3">
        <p v-if="!props.automations.length" class="text-sm text-muted">
          {{ t('automations.empty') }}
        </p>
        <div v-for="a in props.automations" :key="a.id" class="flex items-start gap-2 text-sm">
          <UIcon :name="icons[a.kind]" class="size-4 text-dimmed shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0" :class="{ 'opacity-60': !a.active }">
            <div class="flex flex-wrap items-center gap-1.5">
              <span>{{ describe(a) }}</span>
              <TagChip v-if="a.kind === 'tag_stale' && tagById.get(a.tagId)" :tag="tagById.get(a.tagId)!" />
            </div>
            <p class="text-xs text-muted">
              {{ a.lastRunAt ? t('automations.lastRun', { time: formatDateTime(a.lastRunAt, locale) }) : t('automations.neverRun') }}
            </p>
          </div>
          <USwitch
            :model-value="a.active"
            :disabled="!props.canEdit"
            :aria-label="t('automations.active')"
            @update:model-value="v => emit('update', a, { active: v })"
          />
          <UTooltip v-if="props.canEdit" :text="t('automations.delete')">
            <UButton
              icon="i-lucide-trash"
              color="error"
              variant="ghost"
              size="sm"
              :aria-label="t('automations.delete')"
              @click="emit('delete', a)"
            />
          </UTooltip>
        </div>

        <template v-if="props.canEdit">
          <USeparator class="my-4" />
          <form class="space-y-3" @submit.prevent="add">
            <UFormField :label="t('automations.kind')">
              <USelect v-model="draft.kind" :items="kindItems" class="w-full" />
            </UFormField>
            <div class="flex flex-wrap gap-3">
              <UFormField :label="t('automations.days')" class="w-32">
                <UInputNumber v-model="draft.days" :min="minDays" :max="365" />
              </UFormField>
              <UFormField v-if="draft.kind === 'tag_stale'" :label="t('automations.tag')" class="flex-1 min-w-48">
                <USelectMenu
                  v-model="draft.tagId"
                  :items="props.tags"
                  value-key="id"
                  label-key="name"
                  :placeholder="t('automations.chooseTag')"
                  class="w-full"
                >
                  <template #item-leading="{ item }">
                    <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
                  </template>
                  <template #empty>
                    {{ t('automations.noTags') }}
                  </template>
                </USelectMenu>
              </UFormField>
              <UFormField v-if="draft.kind === 'raise_priority'" :label="t('automations.priority')" class="flex-1 min-w-40">
                <USelect v-model="draft.priority" :items="priorityItems" class="w-full" />
              </UFormField>
            </div>
            <p class="text-sm text-muted">
              {{ describe({ ...draft, tagId: draft.tagId ?? '' } as NewBoardAutomation) }}
            </p>
            <UButton type="submit" icon="i-lucide-plus" :label="t('common.add')" :disabled="!valid" />
          </form>
        </template>
        <p v-else class="text-xs text-muted">
          {{ t('automations.readOnly') }}
        </p>
      </div>
    </template>
  </UModal>
</template>
