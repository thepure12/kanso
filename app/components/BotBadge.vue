<script setup lang="ts">
// Marks a board bot next to its name (members, comments, activity).
const { t } = useI18n()
</script>

<template>
  <UBadge color="neutral" variant="subtle" size="sm" icon="i-lucide-bot" :label="t('bots.badge')" class="shrink-0 align-middle" />
</template>
