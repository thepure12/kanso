<script setup lang="ts">
import type { Column, ColumnRule, Member, NewColumnRule, Tag } from '#shared/types/board'

const props = defineProps<{ column: Column, tags: Tag[], members: Member[] }>()
const emit = defineEmits<{
  add: [rule: NewColumnRule]
  delete: [rule: ColumnRule]
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
  .map(m => ({ label: m.name, value: m.userId, avatar: { src: m.avatarUrl ?? undefined, alt: m.name } })))
// A column sets the due date at most once.
const hasDueRule = computed(() => props.column.rules.some(r => r.kind === 'set_due'))

const draft = reactive({ applyTag: undefined as string | undefined, removeTag: undefined as string | undefined, userId: undefined as string | undefined, dueDays: 3 })
watch(open, (isOpen) => {
  if (isOpen) Object.assign(draft, { applyTag: undefined, removeTag: undefined, userId: undefined, dueDays: 3 })
})

function add(rule: NewColumnRule) {
  emit('add', rule)
  Object.assign(draft, { applyTag: undefined, removeTag: undefined, userId: undefined })
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
          <template v-else>
            <UIcon name="i-lucide-calendar-clock" class="size-4 text-dimmed shrink-0" />
            <span>{{ t('rules.setDue', { n: rule.dueDays }, rule.dueDays) }}</span>
          </template>
          <UButton
            icon="i-lucide-trash"
            color="error"
            variant="ghost"
            class="ms-auto"
            :aria-label="t('rules.delete')"
            @click="emit('delete', rule)"
          />
        </div>

        <USeparator class="my-4" />

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
              <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
            </template>
            <template #empty>
              {{ props.tags.length ? t('rules.everyTag') : t('rules.noTags') }}
            </template>
          </USelectMenu>
          <UButton type="submit" icon="i-lucide-plus" :label="t('common.add')" :disabled="!draft[r.key]" />
        </form>

        <form class="flex items-center gap-2" @submit.prevent="draft.userId && add({ kind: 'assign_to', userId: draft.userId })">
          <span class="text-sm shrink-0 w-24">{{ t('rules.assign') }}</span>
          <USelectMenu
            v-model="draft.userId"
            :items="memberItems"
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
      </div>
    </template>
  </UModal>
</template>
