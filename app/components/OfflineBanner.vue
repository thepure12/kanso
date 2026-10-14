<script setup lang="ts">
/** Shown in the layout while the browser is offline; boards are read-only then (useBoard). */
const offline = useOffline()
const { t } = useI18n()
</script>

<template>
  <UAlert
    v-if="offline"
    color="warning"
    variant="subtle"
    icon="i-lucide-wifi-off"
    :title="t('pwa.offlineTitle')"
    :description="t('pwa.offlineDescription')"
    role="status"
    class="rounded-none"
  />
</template>
