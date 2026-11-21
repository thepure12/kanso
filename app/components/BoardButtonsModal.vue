<script setup lang="ts">
import { buttonAligns, buttonIcons, buttonSortKeys, MAX_BUTTON_STEPS, type BoardButton, type ButtonAlign, type ButtonColor, type ButtonScope, type ButtonStep, type ButtonStepKind } from '#shared/buttons'
import { priorities, type Column, type Member, type Tag } from '#shared/types/board'

const props = defineProps<{
  buttons: BoardButton[]
  columns: Column[]
  tags: Tag[]
  members: Member[]
  /** May make and change shared buttons (editors). Personal ones are always the user's. */
  canEdit: boolean
  create: (input: Omit<BoardButton, 'id' | 'cardIds'>) => Promise<BoardButton>
  update: (button: BoardButton, patch: Partial<Pick<BoardButton, 'name' | 'icon' | 'color' | 'columnIds' | 'steps'>>) => Promise<BoardButton>
  remove: (button: BoardButton) => unknown
  /** Where card buttons sit in their row on cards (board setting); null = left. */
  align?: ButtonAlign | null
  /** May change the alignment (owners of unarchived boards). */
  canSetAlign?: boolean
}>()
const emit = defineEmits<{ setAlign: [align: ButtonAlign | null] }>()
const alignIcons: Record<ButtonAlign, string> = { left: 'i-lucide-align-left', center: 'i-lucide-align-center', right: 'i-lucide-align-right' }
const currentAlign = computed<ButtonAlign>(() => props.align ?? 'left')
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const confirm = useConfirm()
const showError = useApiError()

const names = computed<StepNames>(() => ({
  t,
  column: id => props.columns.find(c => c.id === id)?.title,
  tag: id => props.tags.find(x => x.id === id)?.name,
  person: id => props.members.find(m => m.userId === id)?.name,
}))

const byScope = (scope: ButtonScope) => props.buttons.filter(b => b.scope === scope)
const canManage = (b: BoardButton) => !b.shared || props.canEdit

interface Draft {
  id: string | null
  scope: ButtonScope
  name: string
  icon: string | null
  color: ButtonColor
  shared: boolean
  /** Card buttons: null = every column. New ones start with none picked, so the user chooses. */
  columnIds: string[] | null
  steps: ButtonStep[]
}
const draft = ref<Draft | null>(null)
const nameError = ref('')
const saving = ref(false)

watch(open, (v) => {
  if (!v) draft.value = null
})

function startNew(scope: ButtonScope) {
  nameError.value = ''
  draft.value = { id: null, scope, name: '', icon: null, color: 'accent', shared: props.canEdit, columnIds: scope === 'card' ? [] : null, steps: [blankStep(scope === 'card' ? 'move' : 'archiveColumn')] }
}

function startEdit(b: BoardButton) {
  nameError.value = ''
  draft.value = { id: b.id, scope: b.scope, name: b.name, icon: b.icon, color: b.color, shared: b.shared, columnIds: b.columnIds ? [...b.columnIds] : null, steps: structuredClone(toRaw(b.steps)) }
}

const kindItems = computed(() => draft.value
  ? stepKindsFor(draft.value.scope).map(k => ({ label: t(`buttons.kinds.${k}`), value: k }))
  : [])
const columnItems = computed(() => props.columns.map(c => ({ label: c.title, value: c.id })))
const tagItems = computed(() => props.tags.map(x => ({ label: x.name, value: x.id })))
const memberItems = computed(() => props.members.map(m => ({ label: m.name, value: m.userId })))
const priorityItems = computed(() => [...priorities.map(p => ({ label: t(`priority.${p}`), value: p as string })), { label: t('buttons.noPriority'), value: 'none' }])
const sortItems = computed(() => buttonSortKeys.map(k => ({ label: t(`buttons.sortBy.${k}`), value: k })))
const iconItems = computed(() => [{ label: t('buttons.noIcon'), value: 'none', icon: undefined as string | undefined }, ...buttonIcons.map(i => ({ label: i.replace('i-lucide-', ''), value: i, icon: i as string | undefined }))])

function setKind(index: number, kind: ButtonStepKind) {
  draft.value!.steps[index] = blankStep(kind)
}

function moveStep(index: number, by: number) {
  const steps = draft.value!.steps
  const [step] = steps.splice(index, 1)
  steps.splice(index + by, 0, step!)
}

// A card button may have no column: it is then offered only on the cards it is added to.
const valid = computed(() => !!draft.value && !!draft.value.name.trim() && draft.value.steps.length > 0 && draft.value.steps.every(stepComplete))

/** "Only in Testing, Done" for card buttons limited to columns; gone columns are left out. */
function columnsText(b: BoardButton) {
  if (!b.columnIds) return null
  const titles = props.columns.filter(c => b.columnIds!.includes(c.id)).map(c => c.title)
  return titles.length ? t('buttons.onlyIn', { columns: titles.join(', ') }) : t('buttons.noColumns')
}

async function save() {
  const d = draft.value
  if (!d || !valid.value) return
  saving.value = true
  nameError.value = ''
  const steps = d.steps.map(cleanStep)
  try {
    if (d.id) {
      const button = props.buttons.find(b => b.id === d.id)
      if (button) await props.update(button, { name: d.name.trim(), icon: d.icon, color: d.color, ...(d.scope === 'card' && { columnIds: d.columnIds }), steps })
    }
    else {
      await props.create({ scope: d.scope, name: d.name.trim(), icon: d.icon, color: d.color, shared: d.shared && props.canEdit, columnIds: d.scope === 'card' ? d.columnIds : null, steps })
    }
    draft.value = null
  }
  catch (err) {
    if (isNameTaken(err)) nameError.value = t('buttons.nameTaken')
    else showError(err, t('buttons.errors.save'))
  }
  finally {
    saving.value = false
  }
}

async function removeButton(b: BoardButton) {
  if (await confirm({ title: t('buttons.confirmDelete', { name: b.name }), confirmLabel: t('common.delete') })) props.remove(b)
}

const checklistText = (step: { items: string[] }) => step.items.join('\n')
</script>

<template>
  <UModal v-model:open="open" :title="t('buttons.title')" :description="t('buttons.description')" :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <!-- List -->
      <div v-if="!draft" class="space-y-6">
        <section v-for="scope in (['card', 'board'] as const)" :key="scope" class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">
              {{ t(`buttons.scopes.${scope}`) }}
            </h3>
            <UButton size="sm" variant="soft" icon="i-lucide-plus" :label="t(`buttons.new.${scope}`)" @click="startNew(scope)" />
          </div>
          <p class="text-xs text-muted">
            {{ t(`buttons.scopeHints.${scope}`) }}
          </p>
          <div v-if="scope === 'card' && props.canSetAlign" class="flex items-center gap-2">
            <span id="card-button-align" class="text-xs text-muted">{{ t('buttons.align.label') }}</span>
            <UFieldGroup role="radiogroup" aria-labelledby="card-button-align">
              <UTooltip v-for="a in buttonAligns" :key="a" :text="t(`buttons.align.${a}`)">
                <UButton
                  :icon="alignIcons[a]"
                  size="xs"
                  color="neutral"
                  :variant="currentAlign === a ? 'solid' : 'outline'"
                  role="radio"
                  :aria-checked="currentAlign === a"
                  :aria-label="t(`buttons.align.${a}`)"
                  @click="currentAlign !== a && emit('setAlign', a === 'left' ? null : a)"
                />
              </UTooltip>
            </UFieldGroup>
          </div>
          <p v-if="!byScope(scope).length" class="text-sm text-dimmed">
            {{ t('buttons.empty') }}
          </p>
          <ul class="space-y-2">
            <li v-for="b in byScope(scope)" :key="b.id" class="flex items-start gap-2 rounded-md border border-default p-2">
              <UBadge color="neutral" variant="soft" :icon="b.icon ?? undefined" :label="b.name" class="shrink-0 max-w-48 truncate" :class="buttonColorClass" :style="buttonColorStyle(b.color)" />
              <div class="min-w-0 flex-1 text-xs text-muted">
                <div class="flex items-center gap-1">
                  <UIcon :name="b.shared ? 'i-lucide-users' : 'i-lucide-lock'" class="size-3.5" />
                  {{ b.shared ? t('buttons.sharedHint') : t('buttons.personalHint') }}
                </div>
                <div v-if="columnsText(b)" class="flex items-center gap-1">
                  <UIcon name="i-lucide-columns-3" class="size-3.5" />
                  {{ columnsText(b) }}
                </div>
                <div v-if="b.scope === 'card' && b.cardIds.length" class="flex items-center gap-1">
                  <UIcon name="i-lucide-square-mouse-pointer" class="size-3.5" />
                  {{ t('buttons.onCards', { n: b.cardIds.length }, b.cardIds.length) }}
                </div>
                <ol class="mt-1 list-decimal ps-4">
                  <li v-for="(step, i) in b.steps" :key="i">
                    {{ describeStep(step, names) }}
                  </li>
                </ol>
              </div>
              <template v-if="canManage(b)">
                <UTooltip :text="t('buttons.edit', { name: b.name })">
                  <UButton icon="i-lucide-pencil" variant="ghost" color="neutral" :aria-label="t('buttons.edit', { name: b.name })" @click="startEdit(b)" />
                </UTooltip>
                <UTooltip :text="t('buttons.delete', { name: b.name })">
                  <UButton icon="i-lucide-trash" variant="ghost" color="error" :aria-label="t('buttons.delete', { name: b.name })" @click="removeButton(b)" />
                </UTooltip>
              </template>
            </li>
          </ul>
        </section>
      </div>

      <!-- Editor -->
      <form v-else class="space-y-4" @submit.prevent="save">
        <p class="text-sm font-semibold">
          {{ t(draft.id ? 'buttons.editTitle' : `buttons.new.${draft.scope}`) }}
        </p>
        <div class="flex flex-wrap items-start gap-2">
          <UFormField :label="t('buttons.name')" :error="nameError || undefined" class="flex-1 min-w-48">
            <UInput v-model="draft.name" :maxlength="50" autofocus class="w-full" @update:model-value="nameError = ''" />
          </UFormField>
          <UFormField :label="t('buttons.icon')">
            <USelectMenu
              :model-value="draft.icon ?? 'none'"
              :items="iconItems"
              value-key="value"
              :search-input="false"
              class="w-40"
              @update:model-value="(v: string) => { draft!.icon = v === 'none' ? null : v }"
            />
          </UFormField>
          <UFormField :label="t('buttons.color')">
            <ButtonColorField v-model="draft.color" />
          </UFormField>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted">{{ t('buttons.preview') }}</span>
          <UButton size="sm" color="neutral" variant="soft" :class="buttonColorClass" :style="buttonColorStyle(draft.color)" :icon="draft.icon ?? undefined" :label="draft.name.trim() || t('buttons.name')" tabindex="-1" />
        </div>
        <USwitch
          v-if="!draft.id"
          v-model="draft.shared"
          :disabled="!canEdit"
          :label="t('buttons.shareWithBoard')"
          :description="canEdit ? t('buttons.shareHint') : t('buttons.shareEditorsOnly')"
        />

        <div v-if="draft.scope === 'card'" class="space-y-2">
          <USwitch
            :model-value="draft.columnIds === null"
            :label="t('buttons.allColumns')"
            :description="t('buttons.allColumnsHint')"
            @update:model-value="(v: boolean) => { draft!.columnIds = v ? null : [] }"
          />
          <UFormField v-if="draft.columnIds !== null" :label="t('buttons.showInColumns')" :help="draft.columnIds.length ? undefined : t('buttons.noColumnsHint')">
            <USelectMenu
              v-model="draft.columnIds"
              :items="columnItems"
              value-key="value"
              multiple
              :clear="{ 'aria-label': t('buttons.clearColumns') }"
              :placeholder="t('buttons.pickColumns')"
              class="w-full"
            />
          </UFormField>
        </div>

        <div class="space-y-2">
          <p class="text-sm font-medium">
            {{ t('buttons.steps') }}
          </p>
          <div v-for="(step, i) in draft.steps" :key="i" class="flex flex-wrap items-start gap-2 rounded-md border border-default p-2">
            <span class="mt-1.5 w-5 text-xs text-muted text-end">{{ i + 1 }}.</span>
            <USelect :model-value="step.kind" :items="kindItems" class="w-52" :aria-label="t('buttons.stepKind', { n: i + 1 })" @update:model-value="(k: ButtonStepKind) => setKind(i, k)" />

            <USelect v-if="step.kind === 'move' || step.kind === 'archiveColumn' || step.kind === 'sortColumn'" v-model="step.columnId" :items="columnItems" :placeholder="t('buttons.pickColumn')" class="w-40" :aria-label="t('buttons.pickColumn')" />
            <USelect v-if="step.kind === 'sortColumn'" v-model="step.by" :items="sortItems" class="w-36" :aria-label="t('buttons.sortByLabel')" />
            <template v-if="step.kind === 'moveColumnCards'">
              <USelect v-model="step.from" :items="columnItems" :placeholder="t('buttons.fromColumn')" class="w-36" :aria-label="t('buttons.fromColumn')" />
              <USelect v-model="step.to" :items="columnItems.filter(c => c.value !== step.from)" :placeholder="t('buttons.toColumn')" class="w-36" :aria-label="t('buttons.toColumn')" />
            </template>
            <USelect v-if="step.kind === 'addTag' || step.kind === 'removeTag'" v-model="step.tagId" :items="tagItems" :placeholder="t('buttons.pickTag')" class="w-40" :aria-label="t('buttons.pickTag')" />
            <USelect v-if="step.kind === 'assign'" v-model="step.userId" :items="memberItems" :placeholder="t('buttons.pickPerson')" class="w-40" :aria-label="t('buttons.pickPerson')" />
            <USelect
              v-if="step.kind === 'setPriority'"
              :model-value="step.priority ?? 'none'"
              :items="priorityItems"
              class="w-36"
              :aria-label="t('buttons.kinds.setPriority')"
              @update:model-value="(p: string) => { step.priority = p === 'none' ? null : p as typeof step.priority }"
            />
            <div v-if="step.kind === 'setDue'" class="flex items-center gap-2">
              <USwitch :model-value="step.inDays === null" :label="t('buttons.clearDue')" @update:model-value="(v: boolean) => { step.inDays = v ? null : 0 }" />
              <template v-if="step.inDays !== null">
                <UInputNumber v-model="step.inDays" :min="0" :max="3650" class="w-28" :aria-label="t('buttons.inDays')" />
                <span class="text-sm text-muted">{{ t('buttons.daysFromToday', { n: step.inDays }, step.inDays) }}</span>
              </template>
            </div>
            <UTextarea
              v-if="step.kind === 'addChecklist'"
              :model-value="checklistText(step)"
              :rows="3"
              autoresize
              :placeholder="t('buttons.checklistPlaceholder')"
              class="flex-1 min-w-48"
              :aria-label="t('buttons.kinds.addChecklist')"
              @update:model-value="(v: string) => { step.items = String(v).split('\n').slice(0, 20) }"
            />

            <div class="ms-auto flex">
              <UButton icon="i-lucide-arrow-up" variant="ghost" color="neutral" size="sm" :disabled="i === 0" :aria-label="t('buttons.stepUp')" @click="moveStep(i, -1)" />
              <UButton icon="i-lucide-arrow-down" variant="ghost" color="neutral" size="sm" :disabled="i === draft.steps.length - 1" :aria-label="t('buttons.stepDown')" @click="moveStep(i, 1)" />
              <UButton icon="i-lucide-x" variant="ghost" color="error" size="sm" :disabled="draft.steps.length === 1" :aria-label="t('buttons.removeStep')" @click="draft.steps.splice(i, 1)" />
            </div>
          </div>
          <UButton
            variant="soft"
            color="neutral"
            size="sm"
            icon="i-lucide-plus"
            :label="t('buttons.addStep')"
            :disabled="draft.steps.length >= MAX_BUTTON_STEPS"
            @click="draft.steps.push(blankStep(stepKindsFor(draft.scope)[0]!))"
          />
        </div>

        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="draft = null" />
          <UButton type="submit" :label="t('common.save')" :loading="saving" :disabled="!valid" />
        </div>
      </form>
    </template>
  </UModal>
</template>
