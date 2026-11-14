<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { BoardNotificationLevel } from '#shared/notificationSettings'

// The current user's notification level for this board (personal, any role).
const props = defineProps<{ board: { id: string, notificationLevel: BoardNotificationLevel } }>()

const { t } = useI18n()
const showError = useApiError()

const icons: Record<BoardNotificationLevel, string> = {
  all: 'i-lucide-bell',
  direct: 'i-lucide-at-sign',
  none: 'i-lucide-bell-off',
}
const labels: Record<BoardNotificationLevel, [string, string]> = {
  all: ['board.notifyAll', 'board.notifyAllDescription'],
  direct: ['board.notifyDirect', 'board.notifyDirectDescription'],
  none: ['board.notifyNone', 'board.notifyNoneDescription'],
}

async function setLevel(level: BoardNotificationLevel) {
  const board = props.board
  const old = board.notificationLevel
  if (level === old) return
  board.notificationLevel = level
  try {
    await api(`/api/boards/${board.id}/notifications`, { method: 'PUT', body: { level } })
  }
  catch (err) {
    board.notificationLevel = old
    showError(err, t('board.notifyFailed'))
  }
}

const items = computed<DropdownMenuItem[][]>(() => [
  [{ type: 'label', label: t('board.notifications') }],
  (['all', 'direct', 'none'] as const).map(level => ({
    type: 'checkbox' as const,
    label: t(labels[level][0]),
    description: t(labels[level][1]),
    icon: icons[level],
    checked: props.board.notificationLevel === level,
    onSelect: () => setLevel(level),
  })),
])

const tooltip = computed(() => `${t('board.notifications')}: ${t(labels[props.board.notificationLevel][0])}`)
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'start' }" :ui="{ content: 'w-72', itemDescription: 'whitespace-normal' }">
    <UTooltip :text="tooltip">
      <UButton
        color="neutral"
        variant="ghost"
        :icon="icons[board.notificationLevel]"
        :class="board.notificationLevel === 'all' ? 'text-dimmed' : 'text-highlighted'"
        :aria-label="tooltip"
      />
    </UTooltip>
  </UDropdownMenu>
</template>
