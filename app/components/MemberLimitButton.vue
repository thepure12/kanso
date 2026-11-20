<script setup lang="ts">
// Shield for per-member limits (MemberAccessModal): owners get one button that
// also shows the state; everyone else only the badge while limited.
const props = defineProps<{ limited: boolean, canLimit: boolean }>()
const emit = defineEmits<{ limit: [] }>()
const { t } = useI18n()
</script>

<template>
  <UTooltip v-if="props.canLimit" :text="t('memberAccess.button')">
    <UButton
      :color="props.limited ? 'warning' : 'neutral'"
      :variant="props.limited ? 'subtle' : 'ghost'"
      size="sm"
      icon="i-lucide-shield"
      :label="props.limited ? t('memberAccess.limited') : undefined"
      :aria-label="t('memberAccess.button')"
      class="shrink-0"
      @click="emit('limit')"
    />
  </UTooltip>
  <UBadge v-else-if="props.limited" color="warning" variant="subtle" size="sm" icon="i-lucide-shield" :label="t('memberAccess.limited')" class="shrink-0" />
</template>
