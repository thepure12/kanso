<script setup lang="ts">
const props = defineProps<{ label: string, placeholder: string, maxlength?: number }>()
const emit = defineEmits<{ add: [value: string] }>()
const { t } = useI18n()

const editing = ref(false)
const value = ref('')

defineExpose({ open: () => { editing.value = true } })

function submit() {
  const v = value.value.trim()
  if (v) emit('add', v)
  value.value = ''
}
</script>

<template>
  <form v-if="editing" class="flex flex-col gap-2" @submit.prevent="submit">
    <UInput v-model="value" :placeholder="props.placeholder" :maxlength="props.maxlength" autofocus @keydown.esc="editing = false" />
    <div class="flex gap-2">
      <UButton type="submit" size="sm" :label="t('common.add')" />
      <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('common.cancel')" @click="editing = false" />
    </div>
  </form>
  <UButton v-else color="neutral" variant="ghost" icon="i-lucide-plus" :label="props.label" block class="justify-start" @click="editing = true" />
</template>
