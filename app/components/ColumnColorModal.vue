<script setup lang="ts">
import { type ColumnOutline, defaultColumnOutline } from '#shared/columnOutline'

const props = defineProps<{
  title: string
  color: string | null
  /** The column's own outline; null = the board's. */
  outline: ColumnOutline | null
  /** The board's outline, the starting point for an own one. */
  boardOutline: ColumnOutline | null
}>()
const emit = defineEmits<{ save: [value: { color: string | null, outline: ColumnOutline | null }] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const value = ref('#3b82f6')
// A column without a colour keeps none unless one is picked.
const picked = ref(false)
const picker = computed({ get: () => value.value, set: (v: string) => { value.value = v; picked.value = true } })
const shown = computed(() => props.color || picked.value ? value.value : null)
const own = ref(false)
const outline = ref<ColumnOutline>(defaultColumnOutline)
watch(open, (isOpen) => {
  if (!isOpen) return
  value.value = props.color ?? '#3b82f6'
  picked.value = false
  own.value = !!props.outline
  outline.value = props.outline ?? props.boardOutline ?? defaultColumnOutline
}, { immediate: true })

function save(color: string | null) {
  emit('save', { color, outline: own.value ? outline.value : null })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="t('columnColor.title')" :ui="{ content: 'max-w-lg' }">
    <template #body>
      <div class="space-y-4">
        <div
          class="rounded-md px-3 py-2 font-medium truncate"
          :class="!shown && 'bg-elevated ring ring-default'"
          :style="shown ? { backgroundColor: shown, color: contrastText(shown) } : undefined"
        >
          {{ props.title }}
        </div>
        <ColorField v-model="picker" />
        <section class="space-y-3">
          <h3 class="text-sm font-medium">
            {{ t('columnOutline.title') }}
          </h3>
          <USwitch :model-value="!own" :label="t('columnOutline.useBoard')" @update:model-value="v => own = !v" />
          <ColumnOutlinePicker v-if="own" v-model="outline" :column-color="shown" />
        </section>
        <div class="flex justify-between">
          <UButton color="neutral" variant="ghost" icon="i-lucide-eraser" :label="t('columnColor.remove')" :disabled="!props.color" @click="save(null)" />
          <UButton :label="t('common.save')" @click="save(shown)" />
        </div>
      </div>
    </template>
  </UModal>
</template>
