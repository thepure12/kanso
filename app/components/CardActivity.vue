<script setup lang="ts">
import type { Activity } from '#shared/types/board'

const props = defineProps<{ items: Activity[] | null }>()
const { t, locale } = useI18n()
const i18n = useI18nContext()
</script>

<template>
  <div class="pt-2">
    <USkeleton v-if="!props.items" class="h-12 w-full" />
    <ul v-else class="space-y-2">
      <li v-for="a in props.items" :key="a.id" class="text-sm">
        <span class="font-medium">{{ actorLabel(a.actorName, a, i18n) }}</span>
        {{ describeActivity(a, i18n) }}
        <span class="text-xs text-muted ms-1">{{ formatDateTime(a.createdAt, locale) }}</span>
      </li>
    </ul>
  </div>
</template>
