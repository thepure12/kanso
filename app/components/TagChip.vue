<script setup lang="ts">
import type { Tag } from '#shared/types/board'

// compact: a colour bar only, the name as tooltip and accessible label.
defineProps<{ tag: Tag, compact?: boolean }>()
</script>

<template>
  <UTooltip v-if="compact" :text="tag.name">
    <span
      class="inline-block h-2 w-8 rounded-full ring ring-inset ring-black/10"
      :style="{ backgroundColor: tag.color }"
      role="img"
      :aria-label="tag.name"
    />
  </UTooltip>
  <span
    v-else
    class="inline-flex items-center max-w-full rounded px-1.5 py-0.5 text-xs font-medium truncate"
    :style="{ backgroundColor: tag.color, color: contrastText(tag.color) }"
  >
    {{ tag.name }}
  </span>
</template>
