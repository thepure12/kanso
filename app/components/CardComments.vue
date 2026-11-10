<script setup lang="ts">
import type { Comment, Member } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'

const props = defineProps<{ items: Comment[] | null, canEdit: boolean, isOwner: boolean, cd: CardDetailApi, members: Member[] }>()
const { user } = useUserSession()
const { t, locale } = useI18n()

const draft = ref('')
const editing = ref<{ id: string, body: string } | null>(null)

async function post() {
  const body = draft.value.trim()
  if (!body) return
  draft.value = ''
  await props.cd.addComment(body)
}

async function saveEdit(c: Comment) {
  const body = editing.value?.body.trim()
  editing.value = null
  if (body && body !== c.body) await props.cd.editComment(c, body)
}

// Mirrors the card_comments policies; the server decides.
const mine = (c: Comment) => c.authorId === user.value?.id
const canDelete = (c: Comment) => props.isOwner || (props.canEdit && mine(c))
</script>

<template>
  <div class="space-y-4 pt-2">
    <form v-if="props.canEdit" class="space-y-2" @submit.prevent="post">
      <MarkdownEditor v-model="draft" :rows="3" :members="props.members" :placeholder="t('comments.placeholder')" />
      <div class="flex justify-end">
        <UButton type="submit" size="sm" :label="t('comments.submit')" :disabled="!draft.trim()" />
      </div>
    </form>
    <USkeleton v-if="!props.items" class="h-12 w-full" />
    <p v-else-if="!props.items.length" class="text-sm text-muted">
      {{ t('comments.empty') }}
    </p>
    <ul v-else class="space-y-4">
      <li v-for="c in [...props.items].reverse()" :key="c.id" class="flex gap-3">
        <UAvatar :src="c.authorAvatarUrl ?? undefined" :alt="c.importedAuthor ?? c.authorName ?? '?'" size="sm" class="shrink-0" />
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-center gap-2 text-xs">
            <span class="font-medium">{{ c.importedAuthor ?? c.authorName ?? t('card.formerMember') }}</span>
            <UBadge v-if="c.importedAuthor" :label="t('comments.imported')" color="neutral" variant="subtle" size="sm" />
            <span class="text-muted">{{ formatDateTime(c.createdAt, locale) }}</span>
            <span v-if="c.updatedAt !== c.createdAt" class="text-dimmed">{{ t('comments.edited') }}</span>
            <div class="ms-auto flex">
              <UButton v-if="props.canEdit && mine(c) && editing?.id !== c.id" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t('comments.edit')" @click="editing = { id: c.id, body: c.body }" />
              <UButton v-if="canDelete(c)" size="xs" color="error" variant="ghost" icon="i-lucide-trash" :aria-label="t('comments.delete')" @click="props.cd.deleteComment(c)" />
            </div>
          </div>
          <form v-if="editing?.id === c.id" class="space-y-2" @submit.prevent="saveEdit(c)">
            <MarkdownEditor v-model="editing.body" :rows="3" :members="props.members" />
            <div class="flex justify-end gap-2">
              <UButton size="sm" color="neutral" variant="ghost" :label="t('common.cancel')" @click="editing = null" />
              <UButton type="submit" size="sm" :label="t('common.save')" :disabled="!editing.body.trim()" />
            </div>
          </form>
          <MarkdownText v-else :text="c.body" />
        </div>
      </li>
    </ul>
  </div>
</template>
