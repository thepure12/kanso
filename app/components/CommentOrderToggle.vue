<script setup lang="ts">
// Switches the personal comment order (useCommentOrder) between newest first and newest last.
const { t } = useI18n()
const order = useCommentOrder()
const label = computed(() => order.value === 'oldest' ? t('comments.order.newestFirst') : t('comments.order.newestLast'))
</script>

<template>
  <UTooltip :text="label">
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      :icon="order === 'oldest' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'"
      :aria-label="label"
      @click="setCommentOrder(order === 'oldest' ? 'newest' : 'oldest')"
    />
  </UTooltip>
</template>
