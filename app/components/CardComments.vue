<script setup lang="ts">
import type { Comment, Member } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'

// Absent optional booleans would become false; undefined keeps the fallback.
const props = withDefaults(defineProps<{
  items: Comment[] | null
  /** Writing comments and editing one's own (card editors and commenters). */
  canEdit: boolean
  /** Files in the editor become card attachments: card editors only. Defaults to canEdit. */
  canUpload?: boolean
  isOwner: boolean
  /** Viewers may react too; false while the board is archived or offline. */
  canReact: boolean
  cd: CardDetailApi
  members: Member[]
}>(), { canUpload: undefined })
const { t } = useI18n()

const draft = ref('')

async function post() {
  const body = draft.value.trim()
  if (!body) return
  draft.value = ''
  await props.cd.addComment(body)
}
</script>

<template>
  <div class="space-y-4 pt-2">
    <form v-if="props.canEdit" class="space-y-2" @submit.prevent="post">
      <MarkdownEditor v-model="draft" :rows="3" :members="props.members" :upload="props.canUpload ?? props.canEdit ? props.cd.upload : undefined" :placeholder="t('comments.placeholder')" />
      <div class="flex justify-end">
        <UButton type="submit" size="sm" :label="t('comments.submit')" :disabled="!draft.trim()" />
      </div>
    </form>
    <USkeleton v-if="!props.items" class="h-12 w-full" />
    <p v-else-if="!props.items.length" class="text-sm text-muted">
      {{ t('comments.empty') }}
    </p>
    <ul v-else class="space-y-2">
      <CommentItem
        v-for="c in [...props.items].reverse()"
        :key="c.id"
        :comment="c"
        :can-edit="props.canEdit"
        :can-upload="props.canUpload ?? props.canEdit"
        :is-owner="props.isOwner"
        :can-react="props.canReact"
        :cd="props.cd"
        :members="props.members"
      />
    </ul>
  </div>
</template>
