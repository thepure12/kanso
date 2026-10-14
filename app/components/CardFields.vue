<script setup lang="ts">
import type { BoardField, FieldValue } from '#shared/types/board'
import { isValidFieldValue } from '#shared/fields'

const props = defineProps<{ fields: BoardField[], values: Record<string, FieldValue>, canEdit: boolean }>()
const emit = defineEmits<{ set: [field: BoardField, value: FieldValue | null] }>()
const { t } = useI18n()
const i18n = useI18nContext()

// Inputs that did not hold a valid value, by field id.
const errors = ref<Record<string, string>>({})

function set(field: BoardField, value: FieldValue | null) {
  delete errors.value[field.id]
  if ((props.values[field.id] ?? null) !== value) emit('set', field, value)
}

/** Text, number, date and URL inputs save on change; empty clears the value. */
function onInput(field: BoardField, e: Event) {
  const text = (e.target as HTMLInputElement).value.trim()
  if (!text) return set(field, null)
  const value = field.kind === 'number' ? Number(text) : text
  if (isValidFieldValue(field, value)) return set(field, value)
  errors.value[field.id] = t(field.kind === 'url' ? 'cardFields.invalidUrl' : field.kind === 'number' ? 'cardFields.invalidNumber' : 'cardFields.invalid')
}

const selectItems = (field: BoardField) => [
  { label: t('common.none'), value: null, color: undefined as string | undefined },
  ...field.options.map(o => ({ label: o.label, value: o.id, color: o.color })),
]
const option = (field: BoardField) => field.options.find(o => o.id === props.values[field.id])
</script>

<template>
  <div v-if="props.fields.length" class="space-y-4">
    <UFormField v-for="field in props.fields" :key="field.id" :label="field.name" :error="errors[field.id]">
      <div v-if="!props.canEdit">
        <a
          v-if="field.kind === 'url' && props.values[field.id] !== undefined"
          :href="String(props.values[field.id])"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-primary break-all hover:underline"
        >
          {{ props.values[field.id] }}
        </a>
        <p v-else-if="formatFieldValue(field, props.values[field.id], i18n)" class="text-sm break-words">
          {{ formatFieldValue(field, props.values[field.id], i18n) }}
        </p>
        <p v-else class="text-sm text-muted">
          {{ t('common.none') }}
        </p>
      </div>
      <div v-else>
        <UCheckbox
          v-if="field.kind === 'checkbox'"
          :model-value="props.values[field.id] === true"
          :aria-label="field.name"
          @update:model-value="v => set(field, v === true)"
        />
        <USelect
          v-else-if="field.kind === 'select'"
          :model-value="(props.values[field.id] as string | undefined) ?? null"
          :items="selectItems(field)"
          class="w-full"
          @update:model-value="v => set(field, (v as string | null) ?? null)"
        >
          <template #leading>
            <span v-if="option(field)" class="size-3 rounded-full" :style="{ backgroundColor: option(field)!.color }" />
          </template>
          <template #item-leading="{ item }">
            <span v-if="item.color" class="size-3 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
          </template>
        </USelect>
        <UInput
          v-else
          :key="String(props.values[field.id])"
          :default-value="props.values[field.id] === undefined ? '' : String(props.values[field.id])"
          :type="field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : field.kind === 'url' ? 'url' : 'text'"
          :step="field.kind === 'number' ? 'any' : undefined"
          :maxlength="field.kind === 'text' || field.kind === 'url' ? 2000 : undefined"
          :placeholder="field.kind === 'url' ? 'https://' : undefined"
          class="w-full"
          @change="onInput(field, $event)"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        />
      </div>
    </UFormField>
  </div>
</template>
