<script setup lang="ts">
import type { Tag } from '#shared/types/board'

// compact: a colour bar only, the name as tooltip and accessible label.
defineProps<{ tag: Tag, compact?: boolean }>()
</script>

<template>
  <span
    v-if="compact"
    class="inline-block h-2 w-8 rounded-full ring ring-inset ring-black/10"
    :style="{ backgroundColor: tag.color }"
    :title="tag.name"
    role="img"
    :aria-label="tag.name"
  />
  <span
    v-else
    class="inline-flex items-center max-w-full rounded px-1.5 py-0.5 text-xs font-medium truncate"
    :style="{ backgroundColor: tag.color, color: contrastText(tag.color) }"
  >
    {{ tag.name }}
  </span>
</template>
