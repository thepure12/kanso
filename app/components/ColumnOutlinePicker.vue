<script setup lang="ts">
import { type ColumnOutline, columnOutlineColors, columnOutlineGlows, columnOutlineStyle, columnOutlineWidths } from '#shared/columnOutline'

// Colour, thickness and glow of a column frame, with a small preview column.
const props = defineProps<{
  /** Heading colour of the column for 'column' and the preview; null on the board-wide picker. */
  columnColor?: string | null
}>()
const outline = defineModel<ColumnOutline>({ required: true })
const { t } = useI18n()

// Colours already used on the board, offered after the presets.
const sources = inject(boardColorsKey, null)
const used = computed(() => sources ? boardColors(sources.value, columnOutlineColors) : [])

const customColor = computed(() => {
  const c = outline.value.color
  return c && c !== 'accent' && c !== 'column' && !(columnOutlineColors as readonly string[]).includes(c) && !used.value.includes(c) ? c : null
})
const preview = computed(() => columnOutlineStyle(outline.value, false, props.columnColor) ?? {})

function set(patch: Partial<ColumnOutline>) {
  outline.value = { ...outline.value, ...patch }
}

function onColor(e: Event) {
  const value = (e.target as HTMLInputElement).value.toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(value)) set({ color: value })
}

const tile = 'relative rounded-full size-7 ring-offset-2 ring-offset-default transition focus-visible:outline-2 focus-visible:outline-primary'
const ring = (current: boolean) => current ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-accented'
</script>

<template>
  <div class="flex gap-4 items-start">
    <div class="flex-1 space-y-3 min-w-0">
      <div class="flex flex-wrap gap-2">
        <UTooltip :text="t('columnOutline.default')">
          <button
            type="button"
            class="border border-dashed border-accented"
            :class="[tile, ring(outline.color === null)]"
            :aria-label="t('columnOutline.default')"
            :aria-pressed="outline.color === null"
            @click="set({ color: null })"
          />
        </UTooltip>
        <UTooltip :text="t('columnOutline.accent')">
          <button
            type="button"
            class="flex items-center justify-center bg-primary text-inverted"
            :class="[tile, ring(outline.color === 'accent')]"
            :aria-label="t('columnOutline.accent')"
            :aria-pressed="outline.color === 'accent'"
            @click="set({ color: 'accent' })"
          >
            <UIcon name="i-lucide-link" class="size-3.5" />
          </button>
        </UTooltip>
        <UTooltip :text="t('columnOutline.column')">
          <button
            type="button"
            class="flex items-center justify-center border border-accented"
            :class="[tile, ring(outline.color === 'column')]"
            :style="props.columnColor ? { backgroundColor: props.columnColor, color: contrastText(props.columnColor) } : undefined"
            :aria-label="t('columnOutline.column')"
            :aria-pressed="outline.color === 'column'"
            @click="set({ color: 'column' })"
          >
            <UIcon name="i-lucide-columns-3" class="size-3.5" />
          </button>
        </UTooltip>
        <button
          v-for="c in columnOutlineColors"
          :key="c"
          type="button"
          class="ring-inset ring-1 ring-black/10"
          :class="[tile, ring(outline.color === c)]"
          :style="{ backgroundColor: c }"
          :aria-label="c"
          :aria-pressed="outline.color === c"
          @click="set({ color: c })"
        />
        <UTooltip v-for="c in used" :key="`used-${c}`" :text="t('columnOutline.usedColour', { colour: c })">
          <button
            type="button"
            class="ring-inset ring-1 ring-black/10"
            :class="[tile, ring(outline.color === c)]"
            :style="{ backgroundColor: c }"
            :aria-label="t('columnOutline.usedColour', { colour: c })"
            :aria-pressed="outline.color === c"
            @click="set({ color: c })"
          />
        </UTooltip>
        <UTooltip :text="t('columnOutline.custom')">
          <label
            class="flex items-center justify-center cursor-pointer border border-dashed border-accented text-muted hover:text-default"
            :class="[tile, ring(!!customColor)]"
            :style="customColor ? { backgroundColor: customColor, color: contrastText(customColor) } : undefined"
          >
            <UIcon name="i-lucide-pipette" class="size-3.5" />
            <span class="sr-only">{{ t('columnOutline.custom') }}</span>
            <input type="color" class="sr-only" :value="customColor ?? '#0ea5e9'" @change="onColor">
          </label>
        </UTooltip>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div class="flex items-center gap-2" role="group" :aria-label="t('columnOutline.width')">
          <span class="text-xs text-muted">{{ t('columnOutline.width') }}</span>
          <UFieldGroup size="xs">
            <UButton
              v-for="w in columnOutlineWidths"
              :key="w"
              color="neutral"
              :variant="outline.width === w ? 'solid' : 'outline'"
              :label="t('columnOutline.widthPx', { n: w })"
              :aria-pressed="outline.width === w"
              @click="set({ width: w })"
            />
          </UFieldGroup>
        </div>
        <div class="flex items-center gap-2" role="group" :aria-label="t('columnOutline.glow')">
          <span class="text-xs text-muted">{{ t('columnOutline.glow') }}</span>
          <UFieldGroup size="xs">
            <UButton
              v-for="g in columnOutlineGlows"
              :key="g"
              color="neutral"
              :variant="outline.glow === g ? 'solid' : 'outline'"
              :label="t(`columnOutline.glowLevel.${g}`)"
              :aria-pressed="outline.glow === g"
              @click="set({ glow: g })"
            />
          </UFieldGroup>
        </div>
      </div>
    </div>
    <div
      class="hidden sm:flex shrink-0 w-16 h-20 rounded-lg bg-elevated/60 flex-col gap-1 p-1.5 m-3"
      :style="preview"
      aria-hidden="true"
    >
      <div class="h-2.5 rounded" :class="!props.columnColor && 'bg-accented'" :style="props.columnColor ? { backgroundColor: props.columnColor } : undefined" />
      <div class="h-3 rounded bg-default ring ring-default" />
      <div class="h-3 rounded bg-default ring ring-default" />
    </div>
  </div>
</template>
