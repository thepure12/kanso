<script setup lang="ts">
import type { Notification } from '#shared/types/notifications'
import { notificationEvents, type NotificationEvent } from '#shared/notificationSettings'
import { groupInbox } from '~/utils/inbox'

const { t, locale } = useI18n()
const i18n = useI18nContext()
const { user } = useUserSession()
useHead({ title: () => t('inbox.title') })

const { filter, inbox, items, nextCursor, loading, loadingMore, failed, reload, loadMore, setRead, remove, markAllRead, clearRead } = useInbox()

const today = isoDate()
const groups = computed(() => groupInbox(items.value, today))
const cardLink = (boardId: string, cardId: string) => `/boards/${boardId}?card=${cardId}`

const ALL = 'all'
const readItems = computed(() => [
  { label: t('inbox.all'), value: 'all' },
  { label: t('inbox.unread'), value: 'unread' },
])
const readMode = computed({
  get: () => filter.unread ? 'unread' : 'all',
  set: (v: string) => { filter.unread = v === 'unread' },
})
const boardItems = computed(() => [
  { label: t('inbox.allBoards'), value: ALL },
  ...(inbox.value?.boards ?? []).map(b => ({ label: b.unread ? `${b.name} (${b.unread})` : b.name, value: b.id })),
])
const boardValue = computed({
  get: () => filter.boardId ?? ALL,
  set: (v: string) => { filter.boardId = v === ALL ? null : v },
})
const eventItems = computed(() => [
  { label: t('inbox.allEvents'), value: ALL },
  ...notificationEvents.map(e => ({ label: t(`account.notifications.events.${e}`), value: e })),
])
const eventValue = computed({
  get: () => filter.event ?? ALL,
  set: (v: string) => { filter.event = v === ALL ? null : v as NotificationEvent },
})
const filtered = computed(() => filter.unread || !!filter.boardId || !!filter.event)

/** Unread among what the filters cover: for "Mark all read". */
const unreadHere = computed(() => filter.boardId
  ? inbox.value?.boards.find(b => b.id === filter.boardId)?.unread ?? 0
  : inbox.value?.unread ?? 0)

async function open(n: Notification) {
  setRead(n, true)
  await navigateTo(cardLink(n.boardId, n.cardId))
}

function dayLabel(g: { key: string, day: string }) {
  return g.day === 'earlier' ? formatDate(g.key, locale.value) : t(`inbox.${g.day}`)
}
</script>

<template>
  <UContainer class="py-8 space-y-6 max-w-4xl">
    <div class="flex flex-wrap items-center gap-3">
      <UIcon name="i-lucide-inbox" class="size-6 text-muted" />
      <div class="me-auto">
        <h1 class="text-2xl font-semibold">
          {{ t('inbox.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ inbox?.unread ? t('inbox.unreadCount', { count: inbox.unread }, inbox.unread) : t('inbox.allCaughtUp') }}
        </p>
      </div>
      <UButton
        v-if="unreadHere" icon="i-lucide-check-check" color="neutral" variant="outline" size="sm"
        :label="filter.boardId ? t('inbox.markBoardRead') : t('notifications.markAllRead')" @click="markAllRead"
      />
      <UDropdownMenu :items="[[{ label: filter.boardId ? t('inbox.clearBoardRead') : t('inbox.clearRead'), icon: 'i-lucide-trash-2', onSelect: clearRead }]]">
        <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" :aria-label="t('inbox.more')" />
      </UDropdownMenu>
      <UTooltip :text="t('inbox.refresh')">
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" :loading="loading" :aria-label="t('inbox.refresh')" @click="reload(true)" />
      </UTooltip>
    </div>

    <section v-if="inbox?.dueSoon.length" class="space-y-2">
      <h2 class="text-sm font-semibold text-muted">
        {{ t('notifications.dueSoon') }}
      </h2>
      <ul class="divide-y divide-default rounded-md border border-default">
        <li v-for="d in inbox.dueSoon" :key="d.itemId ?? d.cardId">
          <NuxtLink :to="cardLink(d.boardId, d.cardId)" class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-elevated/50">
            <UIcon name="i-lucide-calendar-clock" :class="d.dueDate < today ? 'text-error' : 'text-warning'" class="size-4 shrink-0" />
            <span class="truncate flex-1">
              {{ d.cardTitle }}<span v-if="d.item" class="text-muted"> › <UIcon name="i-lucide-list-checks" class="size-3 align-middle" /> {{ d.item }}</span>
            </span>
            <span class="text-xs text-muted truncate max-w-40">{{ d.boardName }}</span>
            <span class="text-xs shrink-0" :class="d.dueDate < today ? 'text-error' : 'text-muted'">{{ formatDate(d.dueDate, locale) }}</span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <div class="flex flex-wrap items-center gap-2">
      <UTabs v-model="readMode" :items="readItems" :content="false" size="sm" />
      <USelect v-model="boardValue" :items="boardItems" size="sm" class="w-48" :aria-label="t('inbox.board')" />
      <USelect v-model="eventValue" :items="eventItems" size="sm" class="w-48" :aria-label="t('inbox.event')" />
      <UButton
        v-if="filtered" size="sm" color="neutral" variant="link" :label="t('inbox.clearFilters')"
        @click="Object.assign(filter, { unread: false, boardId: null, event: null })"
      />
    </div>

    <UAlert v-if="failed" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.loadFailed')" />
    <USkeleton v-else-if="!inbox" class="h-32" />
    <UEmpty
      v-else-if="!items.length" icon="i-lucide-inbox"
      :title="filtered ? t('inbox.emptyFiltered') : t('inbox.empty')"
      :description="filtered ? undefined : t('inbox.emptyDescription')"
    />

    <section v-for="g in groups" :key="g.key" class="space-y-2">
      <h2 class="text-sm font-semibold text-muted">
        {{ dayLabel(g) }}
      </h2>
      <ul class="divide-y divide-default rounded-md border border-default">
        <li v-for="n in g.items" :key="n.id" class="group flex items-start gap-2 px-3 py-2 hover:bg-elevated/50" :data-unread="!n.readAt || undefined">
          <span class="mt-2 size-2 rounded-full shrink-0" :class="n.readAt ? 'bg-transparent' : 'bg-primary'" />
          <NuxtLink :to="cardLink(n.boardId, n.cardId)" class="min-w-0 flex-1 text-sm" :class="{ 'text-muted': n.readAt }" @click.prevent="open(n)">
            <span class="block font-medium truncate" :class="{ 'text-highlighted': !n.readAt }">{{ n.cardTitle }}</span>
            <span class="block">
              {{ actorLabel(n.activity.actorName, n.activity, i18n) }} {{ describeNotification(n.activity, i18n, user?.id) }}
            </span>
            <span class="block text-xs text-muted">{{ n.boardName }} · {{ formatDateTime(n.activity.createdAt, locale) }}</span>
          </NuxtLink>
          <div class="flex shrink-0 gap-1 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-within:opacity-100">
            <UTooltip :text="n.readAt ? t('inbox.markUnread') : t('inbox.markRead')">
              <UButton
                size="xs" color="neutral" variant="ghost" :icon="n.readAt ? 'i-lucide-mail' : 'i-lucide-mail-open'"
                :aria-label="n.readAt ? t('inbox.markUnread') : t('inbox.markRead')" @click="setRead(n, !n.readAt)"
              />
            </UTooltip>
            <UTooltip :text="t('inbox.remove')">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('inbox.remove')" @click="remove(n)" />
            </UTooltip>
          </div>
        </li>
      </ul>
    </section>

    <div v-if="nextCursor" class="flex justify-center">
      <UButton color="neutral" variant="outline" :loading="loadingMore" :label="t('inbox.loadMore')" @click="loadMore" />
    </div>
  </UContainer>
</template>
