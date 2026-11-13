<script setup lang="ts">
import type { Notification } from '#shared/types/notifications'

const { inbox, unread, markRead, markAllRead } = useNotifications()
const { user } = useUserSession()
const { t, locale } = useI18n()
const i18n = useI18nContext()
const open = ref(false)
const today = isoDate()

const cardLink = (boardId: string, cardId: string) => `/boards/${boardId}?card=${cardId}`

async function select(n: Notification) {
  open.value = false
  markRead(n)
  await navigateTo(cardLink(n.boardId, n.cardId))
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'end' }">
    <UChip :show="unread > 0" :text="unread > 99 ? '99+' : unread" size="3xl" inset>
      <UTooltip :text="unread ? t('notifications.unreadLabel', { count: unread }) : t('notifications.title')">
        <UButton color="neutral" variant="ghost" icon="i-lucide-bell" :aria-label="unread ? t('notifications.unreadLabel', { count: unread }) : t('notifications.title')" />
      </UTooltip>
    </UChip>

    <template #content>
      <div class="w-[calc(100vw-1.5rem)] sm:w-96 max-h-[70vh] overflow-y-auto">
        <div class="flex items-center justify-between px-3 py-2 border-b border-default">
          <span class="font-semibold text-sm">{{ t('notifications.title') }}</span>
          <UButton v-if="unread" size="xs" variant="link" :label="t('notifications.markAllRead')" @click="markAllRead" />
        </div>

        <USkeleton v-if="!inbox" class="h-16 m-3" />
        <template v-else>
          <div v-if="inbox.dueSoon.length" class="border-b border-default">
            <p class="px-3 pt-2 text-xs font-medium text-muted">{{ t('notifications.dueSoon') }}</p>
            <NuxtLink
              v-for="d in inbox.dueSoon" :key="d.cardId" :to="cardLink(d.boardId, d.cardId)"
              class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-elevated" @click="open = false"
            >
              <UIcon name="i-lucide-calendar-clock" :class="d.dueDate < today ? 'text-error' : 'text-warning'" class="size-4 shrink-0" />
              <span class="truncate flex-1">{{ d.cardTitle }}</span>
              <span class="text-xs text-muted shrink-0">{{ formatDate(d.dueDate, locale) }}</span>
            </NuxtLink>
          </div>

          <p v-if="!inbox.items.length" class="px-3 py-6 text-sm text-center text-muted">{{ t('notifications.empty') }}</p>
          <ul v-else>
            <li v-for="n in inbox.items" :key="n.id">
              <button
                type="button" class="w-full text-left flex gap-2 px-3 py-2 text-sm hover:bg-elevated"
                :class="{ 'opacity-60': n.readAt }" @click="select(n)"
              >
                <span class="mt-1.5 size-2 rounded-full shrink-0" :class="n.readAt ? 'bg-transparent' : 'bg-primary'" />
                <span class="min-w-0">
                  <span class="block font-medium truncate">{{ n.cardTitle }}</span>
                  <span class="block">
                    {{ actorLabel(n.activity.actorName, n.activity, i18n) }} {{ describeNotification(n.activity, i18n, user?.id) }}
                  </span>
                  <span class="block text-xs text-muted">{{ n.boardName }} · {{ formatDateTime(n.activity.createdAt, locale) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </template>
      </div>
    </template>
  </UPopover>
</template>
