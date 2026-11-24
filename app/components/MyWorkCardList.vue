<script setup lang="ts">
import type { MyWorkCard } from '#shared/types/myWork'
import type { MyWorkBucket, MyWorkGroup, MyWorkGroupBy } from '~/utils/myWork'

// Cards of a My work list, grouped by due date bucket or by board. Each row
// opens the card on its board; the circle marks it complete (or open again).
const props = withDefaults(defineProps<{
  cards: MyWorkCard[]
  today: string
  groupBy?: MyWorkGroupBy
  /** Show the assignees' avatars (panels about other people). */
  showAssignees?: boolean
}>(), { groupBy: 'due' })
const emit = defineEmits<{ complete: [card: MyWorkCard, completed: boolean] }>()
const { t, locale } = useI18n()
const i18n = useI18nContext()

const groups = computed<MyWorkGroup[]>(() => groupMyWorkBy(props.cards, props.groupBy, props.today))

const bucketMeta: Record<MyWorkBucket, { icon: string, class: string, due: string }> = {
  overdue: { icon: 'i-lucide-alarm-clock', class: 'text-error', due: 'text-error bg-error/10' },
  today: { icon: 'i-lucide-sun', class: 'text-warning', due: 'text-warning bg-warning/10' },
  soon: { icon: 'i-lucide-calendar-days', class: 'text-primary', due: 'text-primary bg-primary/10' },
  later: { icon: 'i-lucide-calendar', class: 'text-muted', due: 'text-muted bg-elevated' },
  none: { icon: 'i-lucide-calendar-off', class: 'text-muted', due: 'text-muted bg-elevated' },
}
const bucketOf = (c: MyWorkCard) => myWorkBucket(c, props.today)
const priorityBar: Record<string, string> = {
  urgent: 'bg-error', high: 'bg-warning', medium: 'bg-info', low: 'bg-(--ui-border-accented)',
}
const cardLink = (c: MyWorkCard) => `/boards/${c.boardId}?card=${c.id}`
</script>

<template>
  <div class="space-y-5">
    <section v-for="g in groups" :key="g.key" class="space-y-2">
      <h3 class="flex items-center gap-2 text-sm font-semibold" :class="g.bucket ? bucketMeta[g.bucket].class : 'text-muted'">
        <template v-if="g.bucket">
          <UIcon :name="bucketMeta[g.bucket].icon" class="size-4" />
          {{ t(`myWork.buckets.${g.bucket}`) }}
        </template>
        <NuxtLink v-else-if="g.board" :to="`/boards/${g.board.id}`" class="inline-flex items-center gap-2 min-w-0 hover:text-highlighted">
          <UIcon name="i-lucide-kanban" class="size-4 shrink-0" />
          <span class="truncate">{{ g.board.name }}</span>
        </NuxtLink>
        <span class="rounded-full bg-elevated px-2 text-xs font-medium text-muted tabular-nums">{{ g.cards.length }}</span>
      </h3>
      <ul class="divide-y divide-default overflow-hidden rounded-lg border border-default bg-default">
        <li
          v-for="c in g.cards"
          :key="c.id"
          class="group relative flex items-start gap-3 ps-4 pe-3 py-2.5 transition-colors hover:bg-elevated/50"
          :data-card-id="c.id"
        >
          <!-- Priority as a coloured edge. -->
          <span v-if="c.priority" class="absolute inset-y-0 start-0 w-1" :class="priorityBar[c.priority]" aria-hidden="true" />
          <UTooltip :text="t(c.completed ? 'myWork.reopen' : c.done ? 'myWork.inDoneColumn' : 'myWork.complete')">
            <button
              type="button"
              class="mt-0.5 shrink-0 inline-flex size-5 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
              :class="c.done ? 'text-success' : 'text-dimmed hover:text-success'"
              :disabled="c.done && !c.completed"
              :aria-label="t(c.completed ? 'myWork.reopen' : 'myWork.complete') + ': ' + c.title"
              :aria-pressed="c.done"
              @click="emit('complete', c, !c.completed)"
            >
              <UIcon :name="c.done ? 'i-lucide-circle-check' : 'i-lucide-circle'" class="size-5" />
            </button>
          </UTooltip>

          <NuxtLink :to="cardLink(c)" class="min-w-0 flex-1 outline-none focus-visible:underline">
            <span class="block font-medium break-words" :class="c.done ? 'line-through text-muted' : 'text-highlighted'">{{ c.title }}</span>
            <span class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span class="inline-flex items-center gap-1 min-w-0">
                <UIcon v-if="groupBy !== 'board'" name="i-lucide-kanban" class="size-3.5 shrink-0" />
                <span v-if="groupBy !== 'board'" class="truncate">{{ c.boardName }}</span>
                <UIcon v-if="groupBy !== 'board'" name="i-lucide-chevron-right" class="size-3 shrink-0" />
                <span class="truncate">{{ c.columnTitle }}</span>
              </span>
              <span v-if="c.tags.length" class="inline-flex flex-wrap items-center gap-1">
                <TagChip v-for="tag in c.tags" :key="tag.id" :tag="tag" />
              </span>
            </span>
            <ul v-if="c.checklistItems.length" class="mt-1.5 space-y-0.5" :aria-label="t('myWork.checklistItems')">
              <li v-for="i in c.checklistItems" :key="i.id" class="flex items-center gap-2 text-sm text-muted">
                <UIcon name="i-lucide-square" class="size-3.5 shrink-0" />
                <span class="truncate">{{ i.text }}</span>
                <span v-if="i.dueDate" class="ms-auto text-xs shrink-0" :class="i.dueDate < today ? 'text-error' : ''">{{ formatDate(i.dueDate, locale) }}</span>
              </li>
            </ul>
          </NuxtLink>

          <span class="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <UTooltip v-if="c.priority" :text="t(`priority.${c.priority}`)">
              <UBadge
                :color="priorityMeta[c.priority].color"
                :icon="priorityMeta[c.priority].icon"
                variant="subtle"
                size="sm"
                :aria-label="t(`priority.${c.priority}`)"
              />
            </UTooltip>
            <span
              v-if="c.startDate || c.dueDate"
              class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium"
              :class="c.done ? 'text-muted bg-elevated' : bucketMeta[bucketOf(c)].due"
            >
              <UIcon name="i-lucide-calendar" class="size-3.5" />
              {{ formatDateRange(c.startDate, c.dueDate, i18n) }}
            </span>
            <UAvatarGroup v-if="showAssignees && c.assignees.length" :max="3" size="2xs">
              <UAvatar v-for="a in c.assignees" :key="a.id" v-bind="personAvatar(a)" :title="a.name" />
            </UAvatarGroup>
            <UTooltip v-if="c.assigned" :text="t('myWork.assignedToYou')">
              <UIcon name="i-lucide-user-check" class="size-4 text-muted" :aria-label="t('myWork.assignedToYou')" />
            </UTooltip>
            <UTooltip v-if="c.watching" :text="t('myWork.youWatch')">
              <UIcon name="i-lucide-eye" class="size-4 text-muted" :aria-label="t('myWork.youWatch')" />
            </UTooltip>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
