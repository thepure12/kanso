<script setup lang="ts">
import type { ViewerImage } from '~/composables/useImageViewer'

// Opened through useImageViewer(). Click the image to switch between fitting the
// window and its actual size; arrow keys step through several images.
const props = defineProps<{ images: ViewerImage[], index: number }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const current = ref(props.index)
const image = computed(() => props.images[current.value]!)
const many = computed(() => props.images.length > 1)
const actualSize = ref(false)
const failed = ref(false)
// Focus the image area on open: the first header button would show its tooltip,
// which then takes the first Escape.
const stage = ref<HTMLElement>()
function focusStage(e: Event) {
  e.preventDefault()
  stage.value?.focus()
}

function step(by: number) {
  if (!many.value) return
  current.value = (current.value + by + props.images.length) % props.images.length
}
watch(current, () => {
  actualSize.value = false
  failed.value = false
})

defineShortcuts({
  arrowleft: () => step(-1),
  arrowright: () => step(1),
})
</script>

<template>
  <UModal
    :title="image.name || t('imageViewer.title')"
    :description="many ? t('imageViewer.position', { n: current + 1, total: props.images.length }) : undefined"
    :content="{ onOpenAutoFocus: focusStage }"
    :ui="{ content: 'sm:max-w-[min(96vw,80rem)]', body: 'p-0 sm:p-0', description: many ? undefined : 'sr-only' }"
    @update:open="(open: boolean) => { if (!open) emit('close') }"
  >
    <template #actions>
      <UTooltip :text="t('imageViewer.openNewTab')">
        <UButton :to="image.src" target="_blank" external icon="i-lucide-external-link" size="sm" color="neutral" variant="ghost" :aria-label="t('imageViewer.openNewTab')" />
      </UTooltip>
      <UTooltip :text="t('attachments.download')">
        <UButton :to="image.downloadUrl ?? image.src" external download icon="i-lucide-download" size="sm" color="neutral" variant="ghost" :aria-label="t('attachments.download')" />
      </UTooltip>
    </template>
    <template #body>
      <div class="relative flex items-center justify-center bg-elevated/50">
        <div
          ref="stage"
          tabindex="-1"
          class="max-h-[calc(100dvh-10rem)] w-full overflow-auto flex outline-none"
          :class="actualSize ? 'cursor-zoom-out' : 'cursor-zoom-in justify-center items-center'"
        >
          <p v-if="failed" class="p-8 text-sm text-muted">
            {{ t('imageViewer.failed') }}
          </p>
          <img
            v-else
            :key="image.src"
            :src="image.src"
            :alt="image.name ?? ''"
            class="block shrink-0"
            :class="actualSize ? 'max-w-none m-auto' : 'max-h-[calc(100dvh-10rem)] max-w-full object-contain'"
            @click="actualSize = !actualSize"
            @error="failed = true"
          >
        </div>
        <template v-if="many">
          <UButton
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="soft"
            class="absolute start-2 top-1/2 -translate-y-1/2 rounded-full"
            :aria-label="t('imageViewer.previous')"
            @click="step(-1)"
          />
          <UButton
            icon="i-lucide-chevron-right"
            color="neutral"
            variant="soft"
            class="absolute end-2 top-1/2 -translate-y-1/2 rounded-full"
            :aria-label="t('imageViewer.next')"
            @click="step(1)"
          />
        </template>
      </div>
    </template>
  </UModal>
</template>
