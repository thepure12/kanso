<script setup lang="ts">
import type { MatrixThreadMessage } from '#shared/types/matrix'

/** One message of a card's Matrix thread (the content of a list item). */
defineProps<{
  message: MatrixThreadMessage
  /** Marks it as a Matrix message among Kanso comments. */
  showSource?: boolean
}>()
const { t, locale } = useI18n()
const { user } = useUserSession()

const htmlOf = (html: string) => import.meta.client ? sanitizeHtml(html) : ''
const base = basePath()
const imageFailed = ref(false)
</script>

<template>
  <UAvatar :alt="message.senderName" size="sm" class="shrink-0" :icon="message.fromBot && !message.kansoAuthorId ? 'i-lucide-bot' : undefined" />
  <div class="min-w-0 flex-1 space-y-1">
    <div class="flex flex-wrap items-center gap-x-2 text-xs">
      <UTooltip :text="message.sender">
        <span class="font-medium">{{ message.senderName }}</span>
      </UTooltip>
      <UBadge v-if="!message.fromBot && message.kansoUserId && message.kansoUserId === user?.id" :label="t('matrix.thread.you')" color="primary" variant="subtle" size="sm" />
      <UBadge v-if="message.fromBot" :label="message.kansoAuthorId ? t('matrix.thread.viaKanso') : t('matrix.thread.bot')" color="neutral" variant="subtle" size="sm" />
      <UBadge v-if="showSource" :label="t('matrix.thread.tab')" icon="i-lucide-message-square-share" color="info" variant="subtle" size="sm" />
      <span class="text-muted">{{ formatDateTime(message.createdAt, locale) }}</span>
      <span v-if="message.edited" class="text-dimmed">{{ t('comments.edited') }}</span>
    </div>
    <a
      v-if="message.image && !imageFailed"
      :href="base + message.image.url"
      target="_blank"
      rel="noopener"
      class="block w-fit max-w-full"
      :title="message.image.name"
    >
      <img
        :src="base + message.image.thumbnailUrl"
        :alt="message.image.name"
        :width="message.image.width ?? undefined"
        :height="message.image.height ?? undefined"
        loading="lazy"
        class="h-auto max-h-72 w-auto max-w-full rounded-md border border-default bg-elevated object-contain"
        @error="imageFailed = true"
      >
    </a>
    <!-- Sanitized by DOMPurify in sanitizeHtml. -->
    <div v-else-if="message.html && htmlOf(message.html)" class="markdown text-sm break-words" v-html="htmlOf(message.html)" />
    <p v-else class="whitespace-pre-wrap break-words text-sm">
      {{ message.body }}
    </p>
  </div>
</template>
