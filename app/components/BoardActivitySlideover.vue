<script setup lang="ts">
import type { BoardActivity, BoardActivityPage } from '#shared/types/board'

const props = defineProps<{
  boardId: string
  /** Changes when the board reloads, so the feed refetches from the top. */
  version: number
}>()
const open = defineModel<boolean>('open', { required: true })
const showError = useApiError()
const { t, locale } = useI18n()
const i18n = useI18nContext()

const items = ref<BoardActivity[] | null>(null)
const nextCursor = ref<string | null>(null)
const loading = ref(false)

async function load(more = false) {
  loading.value = true
  try {
    const page = await api<BoardActivityPage>(`/api/boards/${props.boardId}/activity`, {
      query: more && nextCursor.value ? { before: nextCursor.value } : {},
    })
    items.value = more ? [...items.value ?? [], ...page.items] : page.items
    nextCursor.value = page.nextCursor
  }
  catch (err) { showError(err, t('boardActivity.loadFailed')) }
  finally { loading.value = false }
}
watch(() => [open.value, props.version] as const, ([isOpen]) => { if (isOpen) load() }, { immediate: true })
</script>

<template>
  <USlideover v-model:open="open" :title="t('boardActivity.title')" :description="t('boardActivity.description')">
    <template #body>
      <USkeleton v-if="!items" class="h-16 w-full" />
      <p v-else-if="!items.length" class="text-sm text-muted">
        {{ t('boardActivity.empty') }}
      </p>
      <template v-else>
        <ul class="divide-y divide-default">
          <li v-for="a in items" :key="a.id" class="py-2 text-sm">
            <ULink :to="{ query: { card: a.cardId } }" class="font-medium text-highlighted hover:underline block truncate" @click="open = false">
              {{ a.cardTitle }}
            </ULink>
            <p>
              <span class="font-medium">{{ actorLabel(a.actorName, a, i18n) }}</span>
              {{ describeActivity(a, i18n) }}
            </p>
            <p class="text-xs text-muted">
              {{ formatDateTime(a.createdAt, locale) }}
            </p>
          </li>
        </ul>
        <UButton
          v-if="nextCursor"
          block
          color="neutral"
          variant="outline"
          :label="t('boardActivity.loadMore')"
          class="mt-4"
          :loading="loading"
          @click="load(true)"
        />
      </template>
    </template>
  </USlideover>
</template>
