<script setup lang="ts">
import type { MyWorkCard } from '#shared/types/myWork'

// Cards of a My work list, grouped by due date bucket. Each row opens the card
// on its board; nothing is draggable.
const props = defineProps<{
  cards: MyWorkCard[]
  today: string
  /** Show the assignees' avatars (panels about other people). */
  showAssignees?: boolean
}>()
const { t, locale } = useI18n()
const i18n = useI18nContext()

const groups = computed(() => groupMyWork(props.cards, props.today))
</script>

<template>
  <div class="space-y-4">
    <section v-for="g in groups" :key="g.bucket" class="space-y-2">
      <h3 class="flex items-center gap-2 text-sm font-semibold" :class="g.bucket === 'overdue' ? 'text-error' : 'text-muted'">
        {{ t(`myWork.buckets.${g.bucket}`) }}
        <UBadge color="neutral" variant="subtle" size="sm" :label="t('myWork.count', { count: g.cards.length }, g.cards.length)" />
      </h3>
      <ul class="divide-y divide-default rounded-md border border-default">
        <li v-for="c in g.cards" :key="c.id">
          <NuxtLink :to="`/boards/${c.boardId}?card=${c.id}`" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-elevated/50">
            <span class="font-medium truncate" :class="{ 'line-through text-muted': c.done }">{{ c.title }}</span>
            <span class="text-xs text-muted truncate">{{ c.boardName }} › {{ c.columnTitle }}</span>
            <span class="ms-auto flex items-center gap-2">
              <UBadge
                v-if="c.priority"
                :color="priorityMeta[c.priority].color"
                :icon="priorityMeta[c.priority].icon"
                variant="subtle"
                size="sm"
                :label="t(`priority.${c.priority}`)"
              />
              <span v-if="c.startDate || c.dueDate" class="text-xs" :class="g.bucket === 'overdue' && !c.done ? 'text-error' : 'text-muted'">
                {{ formatDateRange(c.startDate, c.dueDate, i18n) }}
              </span>
              <UAvatarGroup v-if="showAssignees && c.assignees.length" :max="3" size="2xs">
                <UAvatar v-for="a in c.assignees" :key="a.id" v-bind="personAvatar(a)" :title="a.name" />
              </UAvatarGroup>
              <UIcon v-if="c.assigned" name="i-lucide-user-check" class="size-4 text-muted" :aria-label="t('myWork.assignedToYou')" />
              <UIcon v-if="c.watching" name="i-lucide-eye" class="size-4 text-muted" :aria-label="t('myWork.youWatch')" />
            </span>
            <ul v-if="c.checklistItems.length" class="basis-full space-y-0.5 ps-1" :aria-label="t('myWork.checklistItems')">
              <li v-for="i in c.checklistItems" :key="i.id" class="flex items-center gap-2 text-sm text-muted">
                <UIcon name="i-lucide-square" class="size-3.5 shrink-0" />
                <span class="truncate">{{ i.text }}</span>
                <span v-if="i.dueDate" class="ms-auto text-xs shrink-0" :class="i.dueDate < today ? 'text-error' : ''">{{ formatDate(i.dueDate, locale) }}</span>
              </li>
            </ul>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
