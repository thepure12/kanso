<script setup lang="ts">
import { buttonShownIn, type BoardButton } from '#shared/buttons'
import type { Card, Column, ColumnRule, Member, NewColumnRule, Tag } from '#shared/types/board'

const props = withDefaults(defineProps<{
  column: Column
  tags: Tag[]
  members: Member[]
  cards: Card[]
  /** Card buttons the user may change; each can be offered on this column's cards or not. */
  buttons?: BoardButton[]
  /** Ids of every column of the board, for a button that is shown everywhere until now. */
  columnIds?: string[]
}>(), { buttons: () => [], columnIds: () => [] })
const emit = defineEmits<{
  add: [rule: NewColumnRule, applyToExisting: boolean]
  delete: [rule: ColumnRule]
  /** New columns of a card button (null = every column). */
  buttonColumns: [button: BoardButton, columnIds: string[] | null]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const tagById = computed(() => new Map(props.tags.map(t => [t.id, t])))
const memberById = computed(() => new Map(props.members.map(m => [m.userId, m])))

type TagKind = 'apply_tag' | 'remove_tag'
// Tags without a rule of that kind yet.
const tagsFor = (kind: TagKind) => props.tags.filter(t => !props.column.rules.some(r => r.kind === kind && r.tagId === t.id))
// People not yet assigned by a rule.
const memberItems = computed(() => props.members
  .filter(m => !props.column.rules.some(r => r.kind === 'assign_to' && r.userId === m.userId))
  .map(m => ({ label: m.name, value: m.userId, ...personItem(m, t('bots.badge')) })))
// At most one "assign the mover" rule per column.
const hasMoverRule = computed(() => props.column.rules.some(r => r.kind === 'assign_mover'))
// Select value for the assign_mover rule ("whoever puts the card here": adds or moves it in), listed first.
const MOVER = 'mover'
const assignItems = computed(() => [
  ...hasMoverRule.value ? [] : [{ label: t('rules.mover'), value: MOVER, icon: 'i-lucide-user-check' }],
  ...memberItems.value,
])
// A column sets the due date at most once.
const hasDueRule = computed(() => props.column.rules.some(r => r.kind === 'set_due'))

const draft = reactive({ applyTag: undefined as string | undefined, removeTag: undefined as string | undefined, userId: undefined as string | undefined, dueDays: 3 })
// A tag or assignee rule waiting for the answer to "change the cards already here too?".
const pending = ref<{ rule: NewColumnRule, count: number } | null>(null)
watch(open, (isOpen) => {
  if (isOpen) Object.assign(draft, { applyTag: undefined, removeTag: undefined, userId: undefined, dueDays: 3 })
  pending.value = null
})

/** Cards already in the column that the rule would change (set_due and assign_mover never touch them). */
function affectedCount(rule: NewColumnRule) {
  switch (rule.kind) {
    case 'apply_tag': return props.cards.filter(c => !c.tagIds.includes(rule.tagId)).length
    case 'remove_tag': return props.cards.filter(c => c.tagIds.includes(rule.tagId)).length
    case 'assign_to': return props.cards.filter(c => !c.assigneeIds.includes(rule.userId)).length
    default: return 0
  }
}

function add(rule: NewColumnRule) {
  const count = affectedCount(rule)
  if (count) pending.value = { rule, count }
  else submit(rule, false)
}

function submit(rule: NewColumnRule, applyToExisting: boolean) {
  pending.value = null
  emit('add', rule, applyToExisting)
  Object.assign(draft, { applyTag: undefined, removeTag: undefined, userId: undefined })
}

const shownHere = (b: BoardButton) => buttonShownIn(b, props.column.id)

function toggleButton(b: BoardButton, show: boolean) {
  const current = b.columnIds ?? props.columnIds
  const next = show ? [...new Set([...current, props.column.id])] : current.filter(id => id !== props.column.id)
  // No column left is fine: the button stays on the cards it was added to.
  // Every column again: back to "all columns", so new columns get the button too.
  const all = props.columnIds.length > 0 && props.columnIds.every(id => next.includes(id))
  emit('buttonColumns', b, all ? null : next)
}

const tagRules = computed<{ kind: TagKind, label: string, key: 'applyTag' | 'removeTag' }[]>(() => [
  { kind: 'apply_tag', label: t('rules.applyTag'), key: 'applyTag' },
  { kind: 'remove_tag', label: t('rules.removeTag'), key: 'removeTag' },
])
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('rules.title', { column: props.column.title })"
    :description="t('rules.description')"
  >
    <template #body>
      <div class="space-y-2">
        <p v-if="!props.column.rules.length" class="text-sm text-muted">
          {{ t('rules.empty') }}
        </p>
        <div v-for="rule in props.column.rules" :key="rule.id" class="flex items-center gap-2 text-sm">
          <template v-if="rule.kind === 'apply_tag' || rule.kind === 'remove_tag'">
            <UIcon :name="rule.kind === 'apply_tag' ? 'i-lucide-tag' : 'i-lucide-tag-x'" class="size-4 text-dimmed shrink-0" />
            <span>{{ rule.kind === 'apply_tag' ? t('rules.applyTag') : t('rules.removeTag') }}</span>
            <TagChip v-if="tagById.get(rule.tagId)" :tag="tagById.get(rule.tagId)!" />
          </template>
          <template v-else-if="rule.kind === 'assign_to'">
            <UIcon name="i-lucide-user-plus" class="size-4 text-dimmed shrink-0" />
            <span>{{ t('rules.assign') }}</span>
            <template v-if="memberById.get(rule.userId)">
              <UAvatar
                :src="memberById.get(rule.userId)!.avatarUrl ?? undefined"
                :alt="memberById.get(rule.userId)!.name"
                size="2xs"
              />
              <span>{{ memberById.get(rule.userId)!.name }}</span>
            </template>
            <span v-else class="text-muted">{{ t('rules.formerMember') }}</span>
          </template>
          <template v-else-if="rule.kind === 'assign_mover'">
            <UIcon name="i-lucide-user-check" class="size-4 text-dimmed shrink-0" />
            <span>{{ t('rules.assignMover') }}</span>
          </template>
          <template v-else>
            <UIcon name="i-lucide-calendar-clock" class="size-4 text-dimmed shrink-0" />
            <span>{{ t('rules.setDue', { n: rule.dueDays }, rule.dueDays) }}</span>
          </template>
          <UTooltip :text="t('rules.delete')">
            <UButton
              icon="i-lucide-trash"
              color="error"
              variant="ghost"
              class="ms-auto"
              :aria-label="t('rules.delete')"
              @click="emit('delete', rule)"
            />
          </UTooltip>
        </div>

        <USeparator class="my-4" />

        <div v-if="pending" class="rounded-md border border-default bg-elevated/50 p-3 space-y-3" role="alertdialog" :aria-label="t('rules.existingPrompt', { count: pending.count }, pending.count)">
          <p class="text-sm">
            {{ t('rules.existingPrompt', { count: pending.count }, pending.count) }}
          </p>
          <div class="flex flex-wrap justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="pending = null" />
            <UButton color="neutral" variant="outline" :label="t('rules.onlyNew')" @click="submit(pending.rule, false)" />
            <UButton :label="t('rules.applyExisting', { count: pending.count }, pending.count)" autofocus @click="submit(pending.rule, true)" />
          </div>
        </div>

        <template v-else>
          <form
            v-for="r in tagRules"
            :key="r.kind"
            class="flex items-center gap-2"
            @submit.prevent="draft[r.key] && add({ kind: r.kind, tagId: draft[r.key]! })"
          >
            <span class="text-sm shrink-0 w-24">{{ r.label }}</span>
            <USelectMenu
              v-model="draft[r.key]"
              :items="tagsFor(r.kind)"
              value-key="id"
              label-key="name"
              :placeholder="t('rules.chooseTag')"
              class="flex-1"
            >
              <template #item-leading="{ item }">
                <span class="size-3 rounded-full shrink-0 self-center" :style="{ backgroundColor: item.color }" />
              </template>
              <template #empty>
                {{ props.tags.length ? t('rules.everyTag') : t('rules.noTags') }}
              </template>
            </USelectMenu>
            <UButton type="submit" icon="i-lucide-plus" :label="t('common.add')" :disabled="!draft[r.key]" />
          </form>

          <form class="flex items-center gap-2" @submit.prevent="draft.userId === MOVER ? add({ kind: 'assign_mover' }) : draft.userId && add({ kind: 'assign_to', userId: draft.userId })">
            <span class="text-sm shrink-0 w-24">{{ t('rules.assign') }}</span>
            <USelectMenu
              v-model="draft.userId"
              :items="assignItems"
              value-key="value"
              :placeholder="t('rules.chooseMember')"
              class="flex-1"
            />
            <UButton type="submit" icon="i-lucide-plus" :label="t('common.add')" :disabled="!draft.userId" />
          </form>

          <form class="flex items-center gap-2" @submit.prevent="add({ kind: 'set_due', dueDays: draft.dueDays })">
            <span class="text-sm shrink-0 w-24">{{ t('rules.dueInDays') }}</span>
            <UInputNumber
              v-model="draft.dueDays"
              :min="0"
              :max="365"
              class="flex-1"
              :disabled="hasDueRule"
              :aria-label="t('rules.daysUntilDue')"
            />
            <UButton type="submit" icon="i-lucide-plus" :label="t('common.add')" :disabled="hasDueRule" />
          </form>
          <p v-if="hasDueRule" class="text-xs text-muted">
            {{ t('rules.dueRuleExists') }}
          </p>
        </template>

        <template v-if="props.buttons.length">
          <USeparator class="my-4" />
          <div class="space-y-2" role="group" :aria-label="t('rules.buttonsTitle')">
            <p class="text-sm font-medium">
              {{ t('rules.buttonsTitle') }}
            </p>
            <p class="text-xs text-muted">
              {{ t('rules.buttonsHint') }}
            </p>
            <div v-for="b in props.buttons" :key="b.id" class="flex items-center gap-2">
              <UCheckbox
                :model-value="shownHere(b)"
                :aria-label="t('rules.showButton', { name: b.name })"
                @update:model-value="(v) => toggleButton(b, v === true)"
              />
              <UBadge color="neutral" variant="soft" :class="buttonColorClass" :style="buttonColorStyle(b.color)" :icon="b.icon ?? undefined" :label="b.name" class="max-w-60 truncate" />
              <span class="ms-auto text-xs text-muted">
                {{ b.columnIds === null ? t('buttons.allColumns') : t('rules.buttonColumns', { n: b.columnIds.length }, b.columnIds.length) }}
              </span>
            </div>
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>
