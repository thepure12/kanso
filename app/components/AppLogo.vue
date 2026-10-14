<script setup lang="ts">
/** App icon and name. `large` is for the sign-in and sign-up pages, which have no header. */
defineProps<{ large?: boolean }>()
</script>

<template>
  <span class="inline-flex items-center font-semibold" :class="large ? 'gap-2 text-2xl' : 'gap-1.5'">
    <UIcon name="i-lucide-kanban" class="text-primary" :class="large ? 'size-7' : 'size-5'" />
    <span>Kanso</span>
  </span>
</template>
