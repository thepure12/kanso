<script setup lang="ts">
/** `openable`: Ctrl/Cmd+Enter adds with `open` true (else it bubbles, e.g. to the card dialog's save). */
const props = defineProps<{ label: string, placeholder: string, maxlength?: number, openable?: boolean, icon?: string }>()
const emit = defineEmits<{ add: [value: string, open: boolean] }>()
const { t } = useI18n()

const editing = ref(false)
const value = ref('')

defineExpose({ open: () => { editing.value = true } })

function submit(open = false) {
  const v = value.value.trim()
  if (v) emit('add', v, open)
  value.value = ''
  if (open && v) editing.value = false
}

function onEnter(e: KeyboardEvent) {
  if (e.isComposing) return
  const open = e.ctrlKey || e.metaKey
  if (open && !props.openable) return
  e.preventDefault()
  submit(open)
}
</script>

<template>
  <form v-if="editing" class="flex flex-col gap-2" @submit.prevent="submit()">
    <!-- A textarea so long titles wrap while typing; Enter still adds, pasted line breaks become spaces. -->
    <UTextarea
      :model-value="value"
      :placeholder="props.placeholder"
      :maxlength="props.maxlength"
      autofocus
      autoresize
      :rows="1"
      :maxrows="6"
      @update:model-value="v => value = String(v).replace(/\s*[\r\n]+\s*/g, ' ')"
      @keydown.enter.exact="onEnter"
      @keydown.ctrl.enter.exact="onEnter"
      @keydown.meta.enter.exact="onEnter"
      @keydown.esc="editing = false"
    />
    <div class="flex gap-2">
      <UButton type="submit" size="sm" :label="t('common.add')" />
      <UTooltip :text="t('common.cancel')">
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('common.cancel')" @click="editing = false" />
      </UTooltip>
    </div>
  </form>
  <UButton v-else color="neutral" variant="ghost" :icon="props.icon ?? 'i-lucide-plus'" :label="props.label" block class="justify-start" @click="editing = true" />
</template>
