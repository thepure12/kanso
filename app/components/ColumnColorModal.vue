<script setup lang="ts">
const props = defineProps<{ title: string, color: string | null }>()
const emit = defineEmits<{ save: [color: string | null] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const value = ref('#3b82f6')
watch(open, (isOpen) => {
  if (isOpen) value.value = props.color ?? '#3b82f6'
}, { immediate: true })

function save(color: string | null) {
  emit('save', color)
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="t('columnColor.title')" :ui="{ content: 'max-w-sm' }">
    <template #body>
      <div class="space-y-4">
        <div
          class="rounded-md px-3 py-2 font-medium truncate"
          :style="{ backgroundColor: value, color: contrastText(value) }"
        >
          {{ props.title }}
        </div>
        <ColorField v-model="value" />
        <div class="flex justify-between">
          <UButton color="neutral" variant="ghost" icon="i-lucide-eraser" :label="t('columnColor.remove')" :disabled="!props.color" @click="save(null)" />
          <UButton :label="t('common.save')" @click="save(value)" />
        </div>
      </div>
    </template>
  </UModal>
</template>
