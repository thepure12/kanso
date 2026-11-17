<script setup lang="ts">
const props = defineProps<{ text: string }>()
const base = basePath()
const viewImages = useImageViewer()

// The server renders plain text (no DOM for DOMPurify).
const html = computed(() => import.meta.client ? renderMarkdown(props.text, base) : '')

// Images open in the viewer, stepping through the others in this text; images inside a link
// keep the link.
function onClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.tagName !== 'IMG' || target.closest('a')) return
  const { images, elements } = markdownImages(e.currentTarget as HTMLElement)
  const index = elements.indexOf(target as HTMLImageElement)
  if (index < 0) return
  e.preventDefault()
  e.stopPropagation()
  viewImages(images, index)
}
</script>

<template>
  <!-- Sanitized by DOMPurify in renderMarkdown. -->
  <div v-if="html" class="markdown" @click="onClick" v-html="html" />
  <p v-else class="whitespace-pre-wrap text-sm">
    {{ props.text }}
  </p>
</template>
