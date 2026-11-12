<script setup lang="ts">
import type { BoardSummary } from '#shared/types/board'
import { backgroundStyle } from '#shared/boardBackgrounds'

defineProps<{ boards: BoardSummary[] }>()
const emit = defineEmits<{ star: [board: BoardSummary] }>()

const roleColor = { owner: 'primary', editor: 'success', viewer: 'neutral' } as const
const { t } = useI18n()
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <NuxtLink v-for="b in boards" :key="b.id" :to="`/boards/${b.id}`">
      <UCard class="hover:ring-primary transition overflow-hidden" :class="b.archivedAt && 'opacity-75'" :ui="{ header: 'p-0 sm:px-0 h-14' }">
        <template v-if="b.background" #header>
          <div class="size-full" :style="backgroundStyle(b.background, b.id, true, basePath())" />
        </template>
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-medium truncate">
            {{ b.name }}
          </h3>
          <div class="flex items-center gap-1 shrink-0">
            <UBadge v-if="b.archivedAt" color="neutral" variant="outline" icon="i-lucide-archive" :label="t('board.grid.archived')" />
            <UBadge :color="roleColor[b.role]" variant="subtle" :label="t(`board.role.${b.role}`)" />
            <UTooltip :text="b.starred ? t('board.unstar') : t('board.star')">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :class="b.starred ? 'text-warning' : 'text-dimmed'"
                :aria-label="b.starred ? t('board.unstar') : t('board.star')"
                :aria-pressed="b.starred"
                @click.prevent.stop="emit('star', b)"
              >
                <template #leading>
                  <UIcon name="i-lucide-star" mode="svg" class="size-4" :class="b.starred && '[&_*]:fill-current'" />
                </template>
              </UButton>
            </UTooltip>
          </div>
        </div>
        <p class="text-sm text-muted mt-2 flex items-center gap-1">
          <UIcon name="i-lucide-users" /> {{ t('board.grid.members', { count: b.memberCount }, b.memberCount) }}
        </p>
      </UCard>
    </NuxtLink>
  </div>
</template>
