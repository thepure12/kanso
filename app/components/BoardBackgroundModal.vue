<script setup lang="ts">
import colors from 'tailwindcss/colors'
import { type BoardAccent, boardAccents } from '#shared/boardAccents'
import { type BoardBackground, backgroundColors, backgroundGradients, backgroundPhotos, backgroundStyle } from '#shared/boardBackgrounds'

const props = defineProps<{
  boardId: string
  background: BoardBackground | null
  accent: BoardAccent | null
  /** Uploads the image and makes it the background; resolves when done. */
  upload: (file: File) => Promise<unknown>
}>()
const emit = defineEmits<{ set: [bg: BoardBackground | null], setAccent: [accent: BoardAccent | null] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const toast = useToast()

const MAX_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const isCurrent = (kind: BoardBackground['kind'], value: string) =>
  props.background?.kind === kind && props.background.value === value
const customColor = computed(() => props.background?.kind === 'color' && !(backgroundColors as readonly string[]).includes(props.background.value)
  ? props.background.value
  : null)

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!IMAGE_TYPES.includes(file.type)) {
    toast.add({ title: t('boardBackground.wrongType'), color: 'error' })
    return
  }
  if (file.size > MAX_BYTES) {
    toast.add({ title: t('boardBackground.tooLarge'), color: 'error' })
    return
  }
  uploading.value = true
  try { await props.upload(file) }
  finally { uploading.value = false }
}

function onColor(e: Event) {
  const value = (e.target as HTMLInputElement).value.toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(value)) emit('set', { kind: 'color', value })
}

const tile = 'relative rounded-md ring-offset-2 ring-offset-default transition focus-visible:outline-2 focus-visible:outline-primary'
const ring = (current: boolean) => current ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-accented'
</script>

<template>
  <UModal v-model:open="open" :title="t('boardBackground.title')" :description="t('boardBackground.description')" :ui="{ content: 'max-w-lg' }">
    <template #body>
      <div class="space-y-6">
        <section class="space-y-2">
          <h3 class="text-sm font-medium">
            {{ t('boardBackground.photos') }}
          </h3>
          <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
            <button
              v-for="p in backgroundPhotos"
              :key="p.id"
              type="button"
              class="aspect-[16/10] bg-cover bg-center"
              :class="[tile, ring(isCurrent('photo', p.id))]"
              :style="backgroundStyle({ kind: 'photo', value: p.id }, boardId, true, basePath())"
              :aria-label="t(`boardBackground.photo.${p.id}`)"
              :aria-pressed="isCurrent('photo', p.id)"
              @click="emit('set', { kind: 'photo', value: p.id })"
            />
            <div
              v-if="background?.kind === 'upload'"
              class="aspect-[16/10] bg-cover bg-center"
              :class="[tile, ring(true)]"
              :style="backgroundStyle(background, boardId, false, basePath())"
              role="img"
              :aria-label="t('boardBackground.uploaded')"
            />
            <button
              type="button"
              class="aspect-[16/10] flex flex-col items-center justify-center gap-1 text-xs text-muted border border-dashed border-accented hover:text-default hover:border-inverted"
              :class="tile"
              :disabled="uploading"
              @click="fileInput?.click()"
            >
              <UIcon :name="uploading ? 'i-lucide-loader-circle' : 'i-lucide-image-up'" class="size-5" :class="uploading && 'animate-spin'" />
              {{ uploading ? t('boardBackground.uploading') : t('boardBackground.upload') }}
            </button>
          </div>
          <p class="text-xs text-muted">
            {{ t('boardBackground.uploadHint') }}
          </p>
          <input ref="fileInput" type="file" :accept="IMAGE_TYPES.join(',')" class="hidden" @change="onFile">
        </section>

        <section class="space-y-2">
          <h3 class="text-sm font-medium">
            {{ t('boardBackground.gradients') }}
          </h3>
          <div class="grid grid-cols-4 sm:grid-cols-8 gap-2">
            <button
              v-for="g in backgroundGradients"
              :key="g.id"
              type="button"
              class="aspect-square"
              :class="[tile, ring(isCurrent('gradient', g.id))]"
              :style="{ backgroundImage: g.css }"
              :aria-label="t(`boardBackground.gradient.${g.id}`)"
              :aria-pressed="isCurrent('gradient', g.id)"
              @click="emit('set', { kind: 'gradient', value: g.id })"
            />
          </div>
        </section>

        <section class="space-y-2">
          <h3 class="text-sm font-medium">
            {{ t('boardBackground.colours') }}
          </h3>
          <div class="grid grid-cols-6 sm:grid-cols-11 gap-2">
            <button
              v-for="c in backgroundColors"
              :key="c"
              type="button"
              class="aspect-square"
              :class="[tile, ring(isCurrent('color', c))]"
              :style="{ backgroundColor: c }"
              :aria-label="t('views.useColour', { colour: c })"
              :aria-pressed="isCurrent('color', c)"
              @click="emit('set', { kind: 'color', value: c })"
            />
            <label
              class="aspect-square flex items-center justify-center cursor-pointer border border-dashed border-accented text-muted hover:text-default"
              :class="[tile, customColor && ring(true)]"
              :style="customColor ? { backgroundColor: customColor, color: contrastText(customColor) } : undefined"
            >
              <UIcon name="i-lucide-pipette" class="size-4" />
              <span class="sr-only">{{ t('boardBackground.customColour') }}</span>
              <input type="color" class="sr-only" :value="customColor ?? '#0f766e'" @change="onColor">
            </label>
          </div>
        </section>

        <section class="space-y-2">
          <h3 class="text-sm font-medium">
            {{ t('boardBackground.accent') }}
          </h3>
          <div class="flex flex-wrap gap-2">
            <UTooltip :text="t('boardBackground.accentDefault')">
              <button
                type="button"
                class="size-7 rounded-full flex items-center justify-center border border-dashed border-accented text-muted hover:text-default"
                :class="[tile, ring(!accent)]"
                :aria-label="t('boardBackground.accentDefault')"
                :aria-pressed="!accent"
                @click="emit('setAccent', null)"
              >
                <UIcon name="i-lucide-rotate-ccw" class="size-3.5" />
              </button>
            </UTooltip>
            <UTooltip v-for="a in boardAccents" :key="a" :text="t(`boardBackground.accentColour.${a}`)">
              <button
                type="button"
                class="size-7 rounded-full"
                :class="[tile, ring(accent === a)]"
                :style="{ backgroundColor: colors[a][500] }"
                :aria-label="t(`boardBackground.accentColour.${a}`)"
                :aria-pressed="accent === a"
                @click="emit('setAccent', a)"
              />
            </UTooltip>
          </div>
          <p class="text-xs text-muted">
            {{ t('boardBackground.accentHint') }}
          </p>
        </section>

        <div class="flex justify-end">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-eraser"
            :label="t('boardBackground.remove')"
            :disabled="!background"
            @click="emit('set', null)"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
