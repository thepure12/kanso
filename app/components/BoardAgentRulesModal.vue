<script setup lang="ts">
import {
  AGENT_RULE_INSTRUCTIONS_MAX, AGENT_RULE_NAME_MAX, AGENT_RULE_SETTLE_MAX, agentRuleComments, agentRuleEvents, agentRuleSettleDefaults,
  type AgentRule, type AgentRuleEvent, type Column, type Member, type NewAgentRule, type Tag,
} from '#shared/types/board'

const props = defineProps<{
  boardId: string
  rules: AgentRule[]
  tags: Tag[]
  columns: Column[]
  members: Member[]
  canEdit: boolean
}>()
const emit = defineEmits<{
  add: [rule: NewAgentRule]
  update: [rule: AgentRule, patch: NewAgentRule | { active: boolean }]
  delete: [rule: AgentRule]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const eventIcons: Record<AgentRuleEvent, string> = {
  card_created: 'i-lucide-square-plus',
  card_moved: 'i-lucide-arrow-right-left',
  tag_added: 'i-lucide-tag',
  assigned: 'i-lucide-user-plus',
  mentioned: 'i-lucide-at-sign',
}

const bots = computed(() => props.members.filter(m => m.isBot))
const tagName = (id: string | null) => props.tags.find(x => x.id === id)?.name ?? '?'
const columnTitle = (id: string | null) => props.columns.find(c => c.id === id)?.title ?? '?'
const botName = (id: string | null) => props.members.find(m => m.userId === id)?.name ?? '?'

function whenText(r: NewAgentRule) {
  const bot = botName(r.botId)
  if (r.event === 'tag_added' && r.tagId) return t('agentRules.when.tag_added_tag', { tag: tagName(r.tagId) })
  if (r.event === 'card_moved' && r.columnId) return t('agentRules.when.card_moved_column', { column: columnTitle(r.columnId) })
  return t(`agentRules.when.${r.event}`, { bot })
}

function conditionText(r: NewAgentRule) {
  const parts = [
    r.columnId && r.event !== 'card_moved' && t('agentRules.if.column', { column: columnTitle(r.columnId) }),
    r.tagId && r.event !== 'tag_added' && t('agentRules.if.tag', { tag: tagName(r.tagId) }),
  ].filter(Boolean)
  return parts.length ? t('agentRules.if.prefix', { conditions: parts.join(t('agentRules.and')) }) : null
}

function thenText(r: NewAgentRule) {
  const bot = botName(r.botId)
  return r.moveColumnId
    ? t('agentRules.then.move', { bot, column: columnTitle(r.moveColumnId) })
    : t('agentRules.then.work', { bot })
}

/** How long the runner waits for the card to stay unchanged (null = its --settle, else the event's default). */
function settleText(r: NewAgentRule) {
  if (r.settleSeconds === null) {
    const seconds = agentRuleSettleDefaults[r.event]
    return seconds ? t('agentRules.settleText.default', { seconds }) : t('agentRules.settleText.defaultNow')
  }
  return r.settleSeconds ? t('agentRules.settleText.seconds', { seconds: r.settleSeconds }) : t('agentRules.settleText.now')
}

// ---------------------------------------------------------------- form

// Select items cannot have a null or empty value, so NONE stands for "any" / "nothing".
const NONE = 'none'
const draft = ref<NewAgentRule>(emptyRule())
/** The rule being edited; null = adding a new one. */
const editing = ref<AgentRule | null>(null)

function emptyRule(): NewAgentRule {
  return {
    name: '', botId: bots.value[0]?.userId ?? '', event: 'card_moved', columnId: null, tagId: null,
    instructions: '', moveColumnId: null, comment: 'failure', settleSeconds: null,
  }
}

function reset() {
  draft.value = emptyRule()
  editing.value = null
}
watch(open, (isOpen) => {
  if (isOpen) reset()
})

function edit(r: AgentRule) {
  const { id: _id, active: _active, ...rest } = r
  draft.value = { ...rest }
  editing.value = r
}

function nullable<K extends 'columnId' | 'tagId' | 'moveColumnId'>(key: K) {
  return computed({
    get: () => draft.value[key] ?? NONE,
    set: (v: string) => { draft.value[key] = v === NONE ? null : v },
  })
}
const column = nullable('columnId')
const tag = nullable('tagId')
const moveColumn = nullable('moveColumnId')
/** The settle field as text: empty = null (default). */
const settle = computed({
  get: () => draft.value.settleSeconds === null ? '' : String(draft.value.settleSeconds),
  set: (v: string | number) => {
    const text = String(v ?? '').trim()
    draft.value.settleSeconds = text === '' ? null : Number(text)
  },
})
const settleValid = computed(() => {
  const s = draft.value.settleSeconds
  return s === null || (Number.isInteger(s) && s >= 0 && s <= AGENT_RULE_SETTLE_MAX)
})

const result = computed<NewAgentRule>(() => ({ ...draft.value, name: draft.value.name.trim(), instructions: draft.value.instructions.trim() }))
const valid = computed(() => {
  const r = result.value
  return r.name.length > 0 && r.name.length <= AGENT_RULE_NAME_MAX && r.instructions.length > 0
    && r.instructions.length <= AGENT_RULE_INSTRUCTIONS_MAX && bots.value.some(b => b.userId === r.botId) && settleValid.value
})

const eventItems = computed(() => agentRuleEvents.map(e => ({ label: t(`agentRules.events.${e}`), value: e, icon: eventIcons[e] })))
const anyItem = computed(() => ({ label: t('agentRules.any'), value: NONE }))
const noneItem = computed(() => ({ label: t('agentRules.none'), value: NONE }))
const tagItems = computed(() => props.tags.map(x => ({ label: x.name, value: x.id })))
const columnItems = computed(() => props.columns.map(c => ({ label: c.title, value: c.id })))
const botItems = computed(() => bots.value.map(m => ({ label: m.name, value: m.userId })))
const commentItems = computed(() => agentRuleComments.map(c => ({ label: t(`agentRules.comments.${c}`), value: c })))
const columnLabel = computed(() => draft.value.event === 'card_moved' ? t('agentRules.movedInto') : t('agentRules.inColumn'))
const tagLabel = computed(() => draft.value.event === 'tag_added' ? t('agentRules.addedTag') : t('agentRules.withTag'))

/** "Run these rules": the kanso agent install command builder, opened on demand. */
const runOpen = ref(false)
const botOptions = computed(() => bots.value.map(b => ({ id: b.userId, name: b.name })))

function submit() {
  if (!valid.value) return
  if (editing.value) emit('update', editing.value, result.value)
  else emit('add', result.value)
  reset()
}
</script>

<template>
  <UModal v-model:open="open" :title="t('agentRules.title')" :description="t('agentRules.description')" :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <div class="space-y-3">
        <p v-if="!props.rules.length" class="text-sm text-muted">
          {{ t('agentRules.empty') }}
        </p>
        <div v-for="r in props.rules" :key="r.id" class="flex items-start gap-2 text-sm" data-testid="agent-rule">
          <UIcon :name="eventIcons[r.event]" class="size-4 text-dimmed shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0" :class="{ 'opacity-60': !r.active }">
            <p class="font-medium">
              {{ r.name }}
            </p>
            <p class="text-muted">
              {{ whenText(r) }}<template v-if="conditionText(r)">
                {{ conditionText(r) }}
              </template>
            </p>
            <p>{{ thenText(r) }}</p>
            <p class="text-xs text-muted" data-testid="agent-rule-settle">
              {{ settleText(r) }}
            </p>
          </div>
          <USwitch
            :model-value="r.active"
            :disabled="!props.canEdit"
            :aria-label="t('agentRules.active')"
            @update:model-value="v => emit('update', r, { active: v })"
          />
          <template v-if="props.canEdit">
            <UTooltip :text="t('agentRules.edit')">
              <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="sm" :aria-label="t('agentRules.edit')" @click="edit(r)" />
            </UTooltip>
            <UTooltip :text="t('agentRules.delete')">
              <UButton
                icon="i-lucide-trash"
                color="error"
                variant="ghost"
                size="sm"
                :aria-label="t('agentRules.delete')"
                @click="editing?.id === r.id && reset(); emit('delete', r)"
              />
            </UTooltip>
          </template>
        </div>

        <template v-if="props.canEdit">
          <USeparator class="my-4" />
          <p v-if="!bots.length" class="text-sm text-muted" data-testid="no-bots">
            {{ t('agentRules.noBots') }}
          </p>
          <form v-else class="space-y-4" @submit.prevent="submit">
            <h3 class="text-sm font-semibold">
              {{ editing ? t('agentRules.editTitle') : t('agentRules.addTitle') }}
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField :label="t('agentRules.name')">
                <UInput v-model="draft.name" :maxlength="AGENT_RULE_NAME_MAX" class="w-full" />
              </UFormField>
              <UFormField :label="t('agentRules.bot')">
                <USelect v-model="draft.botId" :items="botItems" class="w-full" />
              </UFormField>
            </div>
            <fieldset class="space-y-2">
              <legend class="text-xs font-semibold uppercase text-muted mb-1">
                {{ t('agentRules.whenLabel') }}
              </legend>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <UFormField :label="t('agentRules.event')">
                  <USelect v-model="draft.event" :items="eventItems" class="w-full" />
                </UFormField>
                <UFormField :label="columnLabel">
                  <USelect v-model="column" :items="[anyItem, ...columnItems]" class="w-full" />
                </UFormField>
                <UFormField :label="tagLabel">
                  <USelect v-model="tag" :items="[anyItem, ...tagItems]" class="w-full" />
                </UFormField>
              </div>
              <UFormField
                :label="t('agentRules.settle')"
                :help="t('agentRules.settleHelp', { seconds: agentRuleSettleDefaults[draft.event] })"
                :error="!settleValid"
              >
                <UInput
                  v-model="settle"
                  type="number"
                  inputmode="numeric"
                  :min="0"
                  :max="AGENT_RULE_SETTLE_MAX"
                  step="1"
                  :placeholder="String(agentRuleSettleDefaults[draft.event])"
                  class="w-32"
                  data-testid="agent-rule-settle-input"
                />
              </UFormField>
            </fieldset>
            <UFormField :label="t('agentRules.instructions')" :help="t('agentRules.instructionsHelp')">
              <UTextarea v-model="draft.instructions" :rows="6" autoresize :maxlength="AGENT_RULE_INSTRUCTIONS_MAX" class="w-full" />
            </UFormField>
            <fieldset class="space-y-2">
              <legend class="text-xs font-semibold uppercase text-muted mb-1">
                {{ t('agentRules.afterLabel') }}
              </legend>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <UFormField :label="t('agentRules.moveColumn')">
                  <USelect v-model="moveColumn" :items="[noneItem, ...columnItems]" class="w-full" />
                </UFormField>
                <UFormField :label="t('agentRules.comment')">
                  <USelect v-model="draft.comment" :items="commentItems" class="w-full" />
                </UFormField>
              </div>
            </fieldset>
            <div class="text-sm text-muted">
              <p>
                {{ whenText(result) }}<template v-if="conditionText(result)">
                  {{ conditionText(result) }}
                </template>
              </p>
              <p>{{ thenText(result) }}</p>
              <p>{{ settleText(result) }}</p>
            </div>
            <div class="flex gap-2">
              <UButton type="submit" :icon="editing ? 'i-lucide-check' : 'i-lucide-plus'" :label="editing ? t('common.save') : t('common.add')" :disabled="!valid" />
              <UButton v-if="editing" color="neutral" variant="ghost" :label="t('common.cancel')" @click="reset" />
            </div>
            <p class="text-xs text-muted">
              {{ t('agentRules.runnerHint') }}
            </p>
          </form>
        </template>
        <p v-else class="text-xs text-muted">
          {{ t('agentRules.readOnly') }}
        </p>

        <template v-if="bots.length">
          <USeparator class="my-4" />
          <UButton
            color="neutral"
            variant="ghost"
            :icon="runOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            :label="t('agentRules.runTitle')"
            class="-ms-2"
            data-testid="run-rules"
            @click="runOpen = !runOpen"
          />
          <div v-if="runOpen" class="space-y-3">
            <p class="text-sm text-muted">
              {{ t('agentRules.runHelp') }}
            </p>
            <AgentCommandBuilder :bots="botOptions" :board-id="props.boardId" :columns="props.columns" />
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>
