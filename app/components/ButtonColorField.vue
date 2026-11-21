<script setup lang="ts">
import type { ButtonColor } from '#shared/buttons'

/** Colour of a board button: the board accent colour or any colour from the picker, in a popover. */
const color = defineModel<ButtonColor>({ required: true })
const { t } = useI18n()

// What the picker shows while the button follows the board colour.
const lastHex = ref<string>(color.value === 'accent' ? colorPresets[5]! : color.value)
const hex = computed({
  get: () => color.value === 'accent' ? lastHex.value : color.value,
  set: (v: string) => {
    lastHex.value = v
    color.value = v as ButtonColor
  },
})
const label = computed(() => color.value === 'accent' ? t('buttons.accentColor') : color.value)
</script>

<template>
  <UPopover>
    <UButton color="neutral" variant="outline" class="w-40" trailing-icon="i-lucide-chevron-down" :aria-label="`${t('buttons.color')}: ${label}`">
      <span class="size-4 shrink-0 rounded-full ring ring-default" :style="{ backgroundColor: buttonCssColor(color) }" />
      <span class="truncate flex-1 text-start">{{ label }}</span>
    </UButton>
    <template #content>
      <div class="p-4 w-[min(18rem,calc(100vw-2rem))] space-y-4">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md p-1.5 text-sm transition"
          :class="color === 'accent' ? 'ring-2 ring-primary' : 'hover:bg-elevated'"
          :aria-pressed="color === 'accent'"
          @click="color = 'accent'"
        >
          <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-inverted">
            <UIcon name="i-lucide-link" class="size-3.5" />
          </span>
          <span class="text-start">
            <span class="block font-medium">{{ t('buttons.accentColor') }}</span>
            <span class="block text-xs text-muted">{{ t('buttons.accentColorHint') }}</span>
          </span>
        </button>
        <ColorField v-model="hex" />
      </div>
    </template>
  </UPopover>
</template>
