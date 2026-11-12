<script setup lang="ts">
// Opened from the account page through useOverlay(): emits close(blob) with the
// cropped, scaled picture, or close(null) on cancel or dismiss.
const props = defineProps<{ file: Blob }>()
const emit = defineEmits<{ close: [Blob | null] }>()
const { t } = useI18n()

/** Edge of the square frame on screen, in px. */
const FRAME = 288

const url = URL.createObjectURL(props.file)
onBeforeUnmount(() => URL.revokeObjectURL(url))

const image = useTemplateRef<HTMLImageElement>('image')
const size = ref<{ w: number, h: number } | null>(null)
const failed = ref(false)
const view = ref<CropView>({ x: 0, y: 0, zoom: 1 })
const saving = ref(false)

function onLoad() {
  const img = image.value!
  size.value = { w: img.naturalWidth, h: img.naturalHeight }
  view.value = centredView(size.value.w, size.value.h, FRAME)
}

const imageStyle = computed(() => {
  if (!size.value) return { visibility: 'hidden' as const }
  const scale = cropScale(size.value.w, size.value.h, FRAME, view.value.zoom)
  return {
    width: `${size.value.w * scale}px`,
    height: `${size.value.h * scale}px`,
    transform: `translate(${view.value.x}px, ${view.value.y}px)`,
  }
})

function setView(next: CropView) {
  if (size.value) view.value = clampView(next, size.value.w, size.value.h, FRAME)
}
function setZoom(zoom: number, px?: number, py?: number) {
  if (size.value) view.value = zoomView(view.value, zoom, size.value.w, size.value.h, FRAME, px, py)
}
const zoom = computed({
  get: () => view.value.zoom,
  set: (z: number) => setZoom(z),
})

// Drag with mouse, pen or one finger.
let drag: { id: number, px: number, py: number, x: number, y: number } | null = null
function onPointerDown(e: PointerEvent) {
  if (!size.value || e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  drag = { id: e.pointerId, px: e.clientX, py: e.clientY, x: view.value.x, y: view.value.y }
}
function onPointerMove(e: PointerEvent) {
  if (drag?.id !== e.pointerId) return
  setView({ x: drag.x + e.clientX - drag.px, y: drag.y + e.clientY - drag.py, zoom: view.value.zoom })
}
function onPointerUp(e: PointerEvent) {
  if (drag?.id === e.pointerId) drag = null
}
function onWheel(e: WheelEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  setZoom(view.value.zoom * Math.exp(-e.deltaY / 500), e.clientX - rect.left, e.clientY - rect.top)
}
function onKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 40 : 10
  const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
  const move = moves[e.key]
  if (move) setView({ x: view.value.x + move[0], y: view.value.y + move[1], zoom: view.value.zoom })
  else if (e.key === '+' || e.key === '=') setZoom(view.value.zoom * 1.1)
  else if (e.key === '-') setZoom(view.value.zoom / 1.1)
  else return
  e.preventDefault()
}

async function save() {
  if (!size.value || !image.value) return
  saving.value = true
  try { emit('close', await renderAvatar(image.value, cropFromView(view.value, size.value.w, size.value.h, FRAME))) }
  catch { failed.value = true }
  finally { saving.value = false }
}
</script>

<template>
  <UModal
    :title="t('account.profile.cropTitle')"
    :description="t('account.profile.cropDescription')"
    :close="false"
    :ui="{ content: 'sm:max-w-sm' }"
    @update:open="(open: boolean) => { if (!open) emit('close', null) }"
  >
    <template #body>
      <UAlert v-if="failed" color="error" variant="subtle" icon="i-lucide-image-off" :title="t('account.profile.cropFailed')" />
      <div v-else class="flex flex-col items-center gap-4">
        <div
          class="relative overflow-hidden rounded-md bg-elevated touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-primary"
          :style="{ width: `${FRAME}px`, height: `${FRAME}px` }"
          tabindex="0"
          role="img"
          :aria-label="t('account.profile.cropArea')"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel.prevent="onWheel"
          @keydown="onKey"
        >
          <img
            ref="image"
            :src="url"
            alt=""
            draggable="false"
            class="absolute top-0 left-0 max-w-none origin-top-left"
            :style="imageStyle"
            @load="onLoad"
            @error="failed = true"
          >
          <!-- Darkens what falls outside the round avatar. -->
          <div class="pointer-events-none absolute inset-0 rounded-full border-2 border-white/80" style="box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.5)" />
        </div>
        <div class="flex items-center gap-3 w-full" :style="{ maxWidth: `${FRAME}px` }">
          <UIcon name="i-lucide-zoom-out" class="size-4 text-muted shrink-0" />
          <USlider v-model="zoom" :min="1" :max="AVATAR_MAX_ZOOM" :step="0.01" :disabled="!size" :aria-label="t('account.profile.cropZoom')" />
          <UIcon name="i-lucide-zoom-in" class="size-4 text-muted shrink-0" />
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="emit('close', null)" />
        <UButton :label="t('common.save')" :loading="saving" :disabled="!size || failed" @click="save" />
      </div>
    </template>
  </UModal>
</template>
