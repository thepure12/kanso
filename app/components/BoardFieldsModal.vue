<script setup lang="ts">
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import { fieldKinds, type BoardField, type FieldKind, type FieldOption } from '#shared/types/board'
import type { NewBoardField } from '~/composables/useBoard'

const emit = defineEmits<{
  create: [field: NewBoardField]
  update: [field: BoardField, patch: Partial<Pick<BoardField, 'name' | 'options' | 'showOnCard'>>]
  /** A field was dragged to `index` (the list is already reordered). */
  move: [index: number]
  delete: [field: BoardField]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const confirm = useConfirm()
const kindLabel = (k: FieldKind) => t(`cardFields.kind.${k}`)
// The board's fields, also the v-model for drag and drop.
const list = defineModel<BoardField[]>('fields', { required: true })
function onDrop(e: SortableEvent) {
  nextTick(() => emit('move', e.newIndex!))
}

const kindItems = computed(() => fieldKinds.map(k => ({ label: kindLabel(k), value: k, icon: fieldKindMeta[k].icon })))
const draft = reactive({ name: '', kind: 'text' as FieldKind })

function create() {
  const name = draft.name.trim()
  if (!name) return
  emit('create', { name, kind: draft.kind, options: [], showOnCard: false })
  draft.name = ''
}

function rename(field: BoardField, e: Event) {
  const input = e.target as HTMLInputElement
  const name = input.value.trim()
  if (!name) input.value = field.name
  else if (name !== field.name) emit('update', field, { name })
}

async function remove(field: BoardField) {
  if (await confirm({ title: t('boardFields.confirmDelete', { name: field.name }), confirmLabel: t('common.delete') })) emit('delete', field)
}

const randomPreset = () => colorPresets[Math.floor(Math.random() * colorPresets.length)]!
const setOptions = (field: BoardField, options: FieldOption[]) => emit('update', field, { options })

function addOption(field: BoardField, label: string) {
  setOptions(field, [...field.options, { id: crypto.randomUUID(), label: label.slice(0, 50), color: randomPreset() }])
}

function renameOption(field: BoardField, option: FieldOption, e: Event) {
  const input = e.target as HTMLInputElement
  const label = input.value.trim()
  if (!label) input.value = option.label
  else if (label !== option.label) setOptions(field, field.options.map(o => o.id === option.id ? { ...o, label } : o))
}

async function removeOption(field: BoardField, option: FieldOption) {
  if (await confirm({ title: t('boardFields.confirmRemoveOption', { label: option.label }), confirmLabel: t('common.remove') })) {
    setOptions(field, field.options.filter(o => o.id !== option.id))
  }
}

// Option colour being edited in a popover; saved when the popover closes.
const picking = ref<{ fieldId: string, optionId: string, color: string } | null>(null)

function setPicking(field: BoardField, option: FieldOption, isOpen: boolean) {
  if (isOpen) {
    picking.value = { fieldId: field.id, optionId: option.id, color: option.color }
    return
  }
  const p = picking.value
  picking.value = null
  if (p?.optionId === option.id && p.color !== option.color) {
    setOptions(field, field.options.map(o => o.id === option.id ? { ...o, color: p.color } : o))
  }
}
const isPicking = (field: BoardField, option: FieldOption) => picking.value?.fieldId === field.id && picking.value.optionId === option.id
</script>

<template>
  <UModal v-model:open="open" :title="t('boardFields.title')" :description="t('boardFields.description')">
    <template #body>
      <div class="space-y-2">
        <p v-if="!list.length" class="text-sm text-muted">
          {{ t('boardFields.empty') }}
        </p>
        <VueDraggable v-model="list" handle=".field-handle" :animation="150" class="space-y-3" @update="onDrop">
          <div v-for="field in list" :key="field.id" class="space-y-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-grip-vertical" class="field-handle size-4 cursor-grab text-dimmed shrink-0" />
              <UTooltip :text="kindLabel(field.kind)">
                <UIcon :name="fieldKindMeta[field.kind].icon" class="size-4 text-muted shrink-0" :aria-label="kindLabel(field.kind)" />
              </UTooltip>
              <UInput :key="field.name" :default-value="field.name" :maxlength="50" class="flex-1" :aria-label="t('boardFields.nameOf', { name: field.name })" @change="rename(field, $event)" />
              <UTooltip :text="field.showOnCard ? t('boardFields.shown') : t('boardFields.hidden')">
                <UButton
                  :icon="field.showOnCard ? 'i-lucide-eye' : 'i-lucide-eye-off'"
                  color="neutral"
                  :variant="field.showOnCard ? 'soft' : 'ghost'"
                  :aria-label="t('boardFields.showOnCards', { name: field.name })"
                  :aria-pressed="field.showOnCard"
                  @click="emit('update', field, { showOnCard: !field.showOnCard })"
                />
              </UTooltip>
              <UTooltip :text="t('boardFields.deleteField', { name: field.name })">
                <UButton icon="i-lucide-trash" color="error" variant="ghost" :aria-label="t('boardFields.deleteField', { name: field.name })" @click="remove(field)" />
              </UTooltip>
            </div>

            <div v-if="field.kind === 'select'" class="ms-12 space-y-1">
              <div v-for="option in field.options" :key="option.id" class="flex items-center gap-2">
                <UPopover :open="isPicking(field, option)" @update:open="v => setPicking(field, option, v)">
                  <button
                    type="button"
                    class="size-6 shrink-0 rounded ring ring-default"
                    :style="{ backgroundColor: isPicking(field, option) ? picking!.color : option.color }"
                    :aria-label="t('views.changeColour', { name: option.label })"
                  />
                  <template #content>
                    <div v-if="picking" class="p-4 w-72">
                      <ColorField v-model="picking.color" />
                    </div>
                  </template>
                </UPopover>
                <UInput
                  :key="option.label"
                  :default-value="option.label"
                  :maxlength="50"
                  size="sm"
                  class="flex-1"
                  :aria-label="t('boardFields.option', { label: option.label })"
                  @change="renameOption(field, option, $event)"
                />
                <UTooltip :text="t('boardFields.removeOption', { label: option.label })">
                  <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="t('boardFields.removeOption', { label: option.label })" @click="removeOption(field, option)" />
                </UTooltip>
              </div>
              <InlineAdd :label="t('boardFields.addOption')" :placeholder="t('boardFields.optionPlaceholder')" @add="label => addOption(field, label)" />
            </div>
          </div>
        </VueDraggable>

        <USeparator class="my-4" />

        <form class="flex items-center gap-2" @submit.prevent="create">
          <UInput v-model="draft.name" :placeholder="t('boardFields.newField')" :maxlength="50" class="flex-1" />
          <USelect v-model="draft.kind" :items="kindItems" class="w-36" :aria-label="t('boardFields.type')" />
          <UButton type="submit" icon="i-lucide-plus" :label="t('common.add')" :disabled="!draft.name.trim()" />
        </form>
      </div>
    </template>
  </UModal>
</template>
