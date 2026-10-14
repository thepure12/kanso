<script setup lang="ts">
/** Colour picker, preset swatches and hex input bound to one lowercase #rrggbb value. */
const value = defineModel<string>({ required: true })
const { t } = useI18n()

const hex = ref('')
watch(value, (v) => { hex.value = v }, { immediate: true })

const validHex = /^#[0-9a-f]{6}$/i
function onHexInput() {
  const v = hex.value.trim()
  const full = v.startsWith('#') ? v : `#${v}`
  if (validHex.test(full)) value.value = full.toLowerCase()
}
</script>

<template>
  <div class="space-y-4">
    <UColorPicker :model-value="value" class="mx-auto" @update:model-value="v => { if (v) value = v.toLowerCase() }" />
    <div class="flex flex-wrap gap-2">
      <button
        v-for="c in colorPresets"
        :key="c"
        type="button"
        class="size-6 rounded-full ring-offset-2 ring-offset-default transition"
        :class="value === c ? 'ring-2 ring-inverted' : 'hover:ring-2 hover:ring-accented'"
        :style="{ backgroundColor: c }"
        :aria-label="t('views.useColour', { colour: c })"
        @click="value = c"
      />
    </div>
    <UFormField :label="t('views.hex')">
      <UInput v-model="hex" class="w-full" placeholder="#3b82f6" @update:model-value="onHexInput" />
    </UFormField>
  </div>
</template>
