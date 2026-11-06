<script setup lang="ts">
// Opened through useConfirm()/useChoice(): emits close(true) on confirm, close(false) on the
// cancel button and close(null) when dismissed (Escape, outside click).
const props = withDefaults(defineProps<{
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  color?: 'error' | 'primary' | 'warning' | 'neutral'
}>(), { color: 'error' })

const emit = defineEmits<{ close: [boolean | null] }>()
const { t } = useI18n()
</script>

<template>
  <UModal :title="props.title" :description="props.description" :close="false" @update:open="(open: boolean) => { if (!open) emit('close', null) }">
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="props.cancelLabel ?? t('common.cancel')" @click="emit('close', false)" />
        <UButton :color="props.color" :label="props.confirmLabel ?? t('common.confirm')" autofocus @click="emit('close', true)" />
      </div>
    </template>
  </UModal>
</template>
