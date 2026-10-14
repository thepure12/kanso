<script setup lang="ts">
import type { Tag } from '#shared/types/board'

defineProps<{ tag: Tag }>()
</script>

<template>
  <span
    class="inline-flex items-center max-w-full rounded px-1.5 py-0.5 text-xs font-medium truncate"
    :style="{ backgroundColor: tag.color, color: contrastText(tag.color) }"
  >
    {{ tag.name }}
  </span>
</template>
