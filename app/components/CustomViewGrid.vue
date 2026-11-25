<script setup lang="ts">
import type { CustomViewSummary } from '#shared/types/customViews'
import { backgroundStyle } from '#shared/boardBackgrounds'

defineProps<{ views: CustomViewSummary[] }>()
const emit = defineEmits<{ star: [view: CustomViewSummary] }>()
const { t } = useI18n()
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <NuxtLink v-for="v in views" :key="v.id" :to="`/views/${v.id}`" data-testid="custom-view-tile">
      <UCard class="hover:ring-primary transition overflow-hidden" :ui="{ header: 'p-0 sm:px-0 h-14' }">
        <template v-if="v.background" #header>
          <div class="size-full" :style="backgroundStyle(v.background, { viewId: v.id }, true, basePath(), v.accent)" />
        </template>
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-medium truncate">
            {{ v.name }}
          </h3>
          <UTooltip :text="v.starred ? t('customViews.unstar') : t('customViews.star')">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              class="shrink-0"
              :class="v.starred ? 'text-warning' : 'text-dimmed'"
              :aria-label="v.starred ? t('customViews.unstar') : t('customViews.star')"
              :aria-pressed="v.starred"
              @click.prevent.stop="emit('star', v)"
            >
              <template #leading>
                <UIcon name="i-lucide-star" mode="svg" class="size-4" :class="v.starred && '[&_*]:fill-current'" />
              </template>
            </UButton>
          </UTooltip>
        </div>
        <p class="text-sm text-muted mt-2 flex items-center gap-1">
          <UIcon name="i-lucide-columns-3" /> {{ t('customViews.columnCount', {}, v.columnCount) }}
        </p>
      </UCard>
    </NuxtLink>
  </div>
</template>
