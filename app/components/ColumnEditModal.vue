<script setup lang="ts">
import type { Column } from '#shared/types/board'
import { COLUMN_DESCRIPTION_MAX } from '#shared/columns'

export type ColumnEdit = Pick<Column, 'title' | 'description' | 'wipLimit'>

const props = defineProps<{ column: Column }>()
const emit = defineEmits<{ save: [value: ColumnEdit] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const title = ref('')
const description = ref('')
const wipLimit = ref<number | null>(null)
watch(open, (isOpen) => {
  if (!isOpen) return
  title.value = props.column.title
  description.value = props.column.description ?? ''
  wipLimit.value = props.column.wipLimit
}, { immediate: true })

const titleValid = computed(() => !!title.value.trim() && title.value.trim().length <= 100)
const descriptionTooLong = computed(() => description.value.trim().length > COLUMN_DESCRIPTION_MAX)
const wipValid = computed(() => wipLimit.value === null || (Number.isInteger(wipLimit.value) && wipLimit.value >= 1 && wipLimit.value <= 999))
const valid = computed(() => titleValid.value && !descriptionTooLong.value && wipValid.value)

function save() {
  if (!valid.value) return
  emit('save', { title: title.value.trim(), description: description.value.trim() || null, wipLimit: wipLimit.value })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="t('columnEdit.title')" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <form class="space-y-4" @submit.prevent="save" @keydown.ctrl.enter.prevent="save" @keydown.meta.enter.prevent="save">
        <UFormField :label="t('board.column.titlePrompt')" :error="titleValid ? undefined : t('columnEdit.titleRequired')">
          <UInput v-model="title" maxlength="100" class="w-full" autofocus />
        </UFormField>
        <UFormField
          :label="t('columnEdit.description')"
          :help="t('columnEdit.descriptionHelp')"
          :error="descriptionTooLong ? t('columnEdit.descriptionTooLong', { max: COLUMN_DESCRIPTION_MAX }) : undefined"
        >
          <MarkdownEditor :key="props.column.id" v-model="description" preview-when-filled :placeholder="t('columnEdit.descriptionPlaceholder')" />
        </UFormField>
        <UFormField :label="t('board.column.wipLimit')" :help="t('board.column.wipPrompt')" :error="wipValid ? undefined : t('board.column.wipInvalid')">
          <UInputNumber
            :model-value="wipLimit ?? undefined"
            :min="1"
            :max="999"
            :placeholder="t('columnEdit.noLimit')"
            class="w-40"
            @update:model-value="v => wipLimit = typeof v === 'number' && !Number.isNaN(v) ? v : null"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="open = false" />
          <UButton type="submit" :label="t('common.save')" :disabled="!valid" />
        </div>
      </form>
    </template>
  </UModal>
</template>
