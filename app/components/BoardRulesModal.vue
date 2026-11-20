<script setup lang="ts">
import {
  boardRuleEvents, priorities,
  type BoardRule, type BoardRuleEvent, type Column, type Member, type NewBoardRule, type Tag,
} from '#shared/types/board'

const props = defineProps<{
  rules: BoardRule[]
  tags: Tag[]
  columns: Column[]
  members: Member[]
  canEdit: boolean
}>()
const emit = defineEmits<{
  add: [rule: NewBoardRule]
  update: [rule: BoardRule, patch: NewBoardRule | { active: boolean }]
  delete: [rule: BoardRule]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const eventIcons: Record<BoardRuleEvent, string> = {
  card_created: 'i-lucide-square-plus',
  card_moved: 'i-lucide-arrow-right-left',
  tag_added: 'i-lucide-tag',
  assigned: 'i-lucide-user-plus',
  due_set: 'i-lucide-calendar',
  checklist_completed: 'i-lucide-list-checks',
  commented: 'i-lucide-message-square',
}

const tagName = (id: string | null) => props.tags.find(x => x.id === id)?.name ?? '?'
const columnTitle = (id: string | null) => props.columns.find(c => c.id === id)?.title ?? '?'
const personName = (id: string | null) => props.members.find(m => m.userId === id)?.name ?? '?'

function whenText(r: NewBoardRule) {
  if (r.event === 'tag_added' && r.eventTagId) return t('boardRules.when.tag_added_tag', { tag: tagName(r.eventTagId) })
  if (r.event === 'assigned' && r.eventUserId) return t('boardRules.when.assigned_user', { name: personName(r.eventUserId) })
  return t(`boardRules.when.${r.event}`)
}

function conditionText(r: NewBoardRule) {
  const c = r.conditions
  const parts = [
    c.tagId && t('boardRules.if.tag', { tag: tagName(c.tagId) }),
    c.priority && t('boardRules.if.priority', { priority: t(`priority.${c.priority}`) }),
    c.columnId && t('boardRules.if.column', { column: columnTitle(c.columnId) }),
    c.assigneeId && t('boardRules.if.assignee', { name: personName(c.assigneeId) }),
  ].filter(Boolean)
  return parts.length ? t('boardRules.if.prefix', { conditions: parts.join(t('boardRules.and')) }) : null
}

function actionText(r: NewBoardRule) {
  const a = r.actions
  const parts = [
    a.moveColumnId && t('boardRules.do.move', { column: columnTitle(a.moveColumnId) }),
    a.addTagId && t('boardRules.do.addTag', { tag: tagName(a.addTagId) }),
    a.removeTagId && t('boardRules.do.removeTag', { tag: tagName(a.removeTagId) }),
    a.assignUserId && t('boardRules.do.assign', { name: personName(a.assignUserId) }),
    a.priority && t('boardRules.do.priority', { priority: t(`priority.${a.priority}`) }),
    a.dueDays !== null && t('boardRules.do.due', { n: a.dueDays }, a.dueDays),
    a.archive && t('boardRules.do.archive'),
  ].filter(Boolean)
  return t('boardRules.do.prefix', { actions: parts.join(', ') })
}

// ---------------------------------------------------------------- form

// Select items cannot have a null or empty value (Reka uses '' to clear), so NONE stands for "any" / "nothing".
const NONE = 'none'
const draft = ref<NewBoardRule>(emptyRule())
/** The rule being edited; null = adding a new one. */
const editing = ref<BoardRule | null>(null)
const dueOn = ref(false)
const dueDays = ref(0)

function reset() {
  draft.value = emptyRule()
  editing.value = null
  dueOn.value = false
  dueDays.value = 0
}
watch(open, (isOpen) => {
  if (isOpen) reset()
})

function edit(r: BoardRule) {
  draft.value = ruleDraft(r)
  editing.value = r
  dueOn.value = r.actions.dueDays !== null
  dueDays.value = r.actions.dueDays ?? 0
}

/** A writable select model over a nullable field, NONE for null. */
function nullable<T extends object, K extends keyof T>(target: () => T, key: K) {
  return computed({
    get: () => (target()[key] as string | null) ?? NONE,
    set: (v: string) => { (target()[key] as unknown) = v === NONE ? null : v },
  })
}
const eventTag = nullable(() => draft.value, 'eventTagId')
const eventUser = nullable(() => draft.value, 'eventUserId')
const condTag = nullable(() => draft.value.conditions, 'tagId')
const condPriority = nullable(() => draft.value.conditions, 'priority')
const condColumn = nullable(() => draft.value.conditions, 'columnId')
const condAssignee = nullable(() => draft.value.conditions, 'assigneeId')
const moveColumn = nullable(() => draft.value.actions, 'moveColumnId')
const addTag = nullable(() => draft.value.actions, 'addTagId')
const removeTag = nullable(() => draft.value.actions, 'removeTagId')
const assignUser = nullable(() => draft.value.actions, 'assignUserId')
const setPriority = nullable(() => draft.value.actions, 'priority')

const result = computed<NewBoardRule>(() => {
  const r = normalizeRule(draft.value)
  r.actions.dueDays = dueOn.value ? dueDays.value : null
  return r
})
const valid = computed(() => ruleValid(result.value))

const eventItems = computed(() => boardRuleEvents.map(e => ({ label: t(`boardRules.events.${e}`), value: e, icon: eventIcons[e] })))
const anyItem = computed(() => ({ label: t('boardRules.any'), value: NONE }))
const noneItem = computed(() => ({ label: t('boardRules.none'), value: NONE }))
const tagItems = computed(() => props.tags.map(x => ({ label: x.name, value: x.id, color: x.color as string | null })))
const columnItems = computed(() => props.columns.map(c => ({ label: c.title, value: c.id, color: c.color })))
const memberItems = computed(() => props.members.map(m => ({ label: m.name, value: m.userId, color: null as string | null, ...(m.isBot ? { description: t('bots.badge') } : {}) })))
const priorityItems = computed(() => priorities.map(p => ({ label: t(`priority.${p}`), value: p, color: null as string | null })))
const withAny = <T,>(items: T[]) => [anyItem.value, ...items]
const withNone = <T,>(items: T[]) => [noneItem.value, ...items]

function submit() {
  if (!valid.value) return
  if (editing.value) emit('update', editing.value, result.value)
  else emit('add', result.value)
  reset()
}
</script>

<template>
  <UModal v-model:open="open" :title="t('boardRules.title')" :description="t('boardRules.description')" :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <div class="space-y-3">
        <p v-if="!props.rules.length" class="text-sm text-muted">
          {{ t('boardRules.empty') }}
        </p>
        <div v-for="r in props.rules" :key="r.id" class="flex items-start gap-2 text-sm">
          <UIcon :name="eventIcons[r.event]" class="size-4 text-dimmed shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0" :class="{ 'opacity-60': !r.active }">
            <p class="font-medium">
              {{ whenText(r) }}
            </p>
            <p v-if="conditionText(r)" class="text-muted">
              {{ conditionText(r) }}
            </p>
            <p>{{ actionText(r) }}</p>
          </div>
          <USwitch
            :model-value="r.active"
            :disabled="!props.canEdit"
            :aria-label="t('boardRules.active')"
            @update:model-value="v => emit('update', r, { active: v })"
          />
          <template v-if="props.canEdit">
            <UTooltip :text="t('boardRules.edit')">
              <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="sm" :aria-label="t('boardRules.edit')" @click="edit(r)" />
            </UTooltip>
            <UTooltip :text="t('boardRules.delete')">
              <UButton
                icon="i-lucide-trash"
                color="error"
                variant="ghost"
                size="sm"
                :aria-label="t('boardRules.delete')"
                @click="editing?.id === r.id && reset(); emit('delete', r)"
              />
            </UTooltip>
          </template>
        </div>

        <template v-if="props.canEdit">
          <USeparator class="my-4" />
          <form class="space-y-4" @submit.prevent="submit">
            <h3 class="text-sm font-semibold">
              {{ editing ? t('boardRules.editTitle') : t('boardRules.addTitle') }}
            </h3>
            <fieldset class="space-y-2">
              <legend class="text-xs font-semibold uppercase text-muted mb-1">
                {{ t('boardRules.whenLabel') }}
              </legend>
              <div class="flex flex-wrap gap-3">
                <UFormField :label="t('boardRules.event')" class="flex-1 min-w-48">
                  <USelect v-model="draft.event" :items="eventItems" class="w-full" />
                </UFormField>
                <UFormField v-if="draft.event === 'tag_added'" :label="t('boardRules.eventTag')" class="flex-1 min-w-40">
                  <USelect v-model="eventTag" :items="withAny(tagItems)" class="w-full" />
                </UFormField>
                <UFormField v-if="draft.event === 'assigned'" :label="t('boardRules.eventUser')" class="flex-1 min-w-40">
                  <USelect v-model="eventUser" :items="withAny(memberItems)" class="w-full" />
                </UFormField>
              </div>
            </fieldset>
            <fieldset class="space-y-2">
              <legend class="text-xs font-semibold uppercase text-muted mb-1">
                {{ t('boardRules.ifLabel') }}
              </legend>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <UFormField :label="t('boardRules.condTag')">
                  <USelect v-model="condTag" :items="withAny(tagItems)" class="w-full" />
                </UFormField>
                <UFormField :label="t('boardRules.condPriority')">
                  <USelect v-model="condPriority" :items="withAny(priorityItems)" class="w-full" />
                </UFormField>
                <UFormField :label="t('boardRules.condColumn')">
                  <USelect v-model="condColumn" :items="withAny(columnItems)" class="w-full" />
                </UFormField>
                <UFormField :label="t('boardRules.condAssignee')">
                  <USelect v-model="condAssignee" :items="withAny(memberItems)" class="w-full" />
                </UFormField>
              </div>
            </fieldset>
            <fieldset class="space-y-2">
              <legend class="text-xs font-semibold uppercase text-muted mb-1">
                {{ t('boardRules.thenLabel') }}
              </legend>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <UFormField :label="t('boardRules.moveColumn')">
                  <USelect v-model="moveColumn" :items="withNone(columnItems)" class="w-full" />
                </UFormField>
                <UFormField :label="t('boardRules.setPriority')">
                  <USelect v-model="setPriority" :items="withNone(priorityItems)" class="w-full" />
                </UFormField>
                <UFormField :label="t('boardRules.addTag')">
                  <USelect v-model="addTag" :items="withNone(tagItems)" class="w-full" />
                </UFormField>
                <UFormField :label="t('boardRules.removeTag')">
                  <USelect v-model="removeTag" :items="withNone(tagItems)" class="w-full" />
                </UFormField>
                <UFormField :label="t('boardRules.assignUser')">
                  <USelect v-model="assignUser" :items="withNone(memberItems)" class="w-full" />
                </UFormField>
                <UFormField :label="t('boardRules.dueDays')">
                  <div class="flex items-center gap-2">
                    <UCheckbox v-model="dueOn" :aria-label="t('boardRules.setDue')" />
                    <UInputNumber v-model="dueDays" :min="0" :max="365" :disabled="!dueOn" class="w-32" />
                  </div>
                </UFormField>
              </div>
              <UCheckbox v-model="draft.actions.archive" :label="t('boardRules.archive')" />
            </fieldset>
            <div class="text-sm text-muted">
              <p>{{ whenText(result) }}</p>
              <p v-if="conditionText(result)">
                {{ conditionText(result) }}
              </p>
              <p v-if="valid">
                {{ actionText(result) }}
              </p>
              <p v-else>
                {{ t('boardRules.needAction') }}
              </p>
            </div>
            <div class="flex gap-2">
              <UButton type="submit" :icon="editing ? 'i-lucide-check' : 'i-lucide-plus'" :label="editing ? t('common.save') : t('common.add')" :disabled="!valid" />
              <UButton v-if="editing" color="neutral" variant="ghost" :label="t('common.cancel')" @click="reset" />
            </div>
          </form>
        </template>
        <p v-else class="text-xs text-muted">
          {{ t('boardRules.readOnly') }}
        </p>
      </div>
    </template>
  </UModal>
</template>
