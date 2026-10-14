<script setup lang="ts">
const props = defineProps<{ text: string }>()

// The server renders plain text (no DOM for DOMPurify).
const html = computed(() => import.meta.client ? renderMarkdown(props.text) : '')
</script>

<template>
  <!-- Sanitized by DOMPurify in renderMarkdown. -->
  <div v-if="html" class="markdown" v-html="html" />
  <p v-else class="whitespace-pre-wrap text-sm">
    {{ props.text }}
  </p>
</template>
