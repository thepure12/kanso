<script setup lang="ts">
// Opened through usePrompt(): emits close(value) on submit, close(null) on cancel or dismiss.
const props = defineProps<{
  title: string
  description?: string
  label?: string
  initial?: string
  confirmLabel?: string
  maxlength?: number
  /** Returns an error message for invalid input, nothing when it is fine. */
  validate?: (value: string) => string | undefined
}>()

const emit = defineEmits<{ close: [string | null] }>()
const { t } = useI18n()

const value = ref(props.initial ?? '')
const error = ref<string>()

function submit() {
  error.value = props.validate?.(value.value)
  if (!error.value) emit('close', value.value)
}
</script>

<template>
  <UModal :title="props.title" :description="props.description" :close="false" @update:open="(open: boolean) => { if (!open) emit('close', null) }">
    <template #body>
      <form id="prompt-form" @submit.prevent="submit">
        <UFormField :label="props.label" :error="error">
          <UInput v-model="value" class="w-full" autofocus :maxlength="props.maxlength" @update:model-value="error = undefined" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="emit('close', null)" />
        <UButton type="submit" form="prompt-form" :label="props.confirmLabel ?? t('common.save')" />
      </div>
    </template>
  </UModal>
</template>
