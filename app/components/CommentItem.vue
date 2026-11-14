<script setup lang="ts">
import type { Comment, Member } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'
import { reactionEmojis } from '#shared/reactions'

/** One card comment as a list item: reactions, edit and delete. */
const props = defineProps<{
  comment: Comment
  canEdit: boolean
  isOwner: boolean
  /** Viewers may react too; false while the board is archived or offline. */
  canReact: boolean
  cd: CardDetailApi
  members: Member[]
}>()
const { user } = useUserSession()
const { t, locale } = useI18n()

const editing = ref<string | null>(null)

async function saveEdit() {
  const body = editing.value?.trim()
  editing.value = null
  if (body && body !== props.comment.body) await props.cd.editComment(props.comment, body)
}

// Mirrors the card_comments policies; the server decides.
const mine = computed(() => props.comment.authorId === user.value?.id)
const canDelete = computed(() => props.isOwner || (props.canEdit && mine.value))

const pickerOpen = ref(false)
function react(emoji: string) {
  pickerOpen.value = false
  props.cd.toggleReaction(props.comment, emoji, user.value?.name ?? '')
}

// The actions show on hover (CSS), after a long press on touch, or while the picker is open.
const el = useTemplateRef<HTMLElement>('el')
const pressedOpen = ref(false)
let pressTimer: ReturnType<typeof setTimeout> | undefined
let pressed = false
function pressStart() {
  clearTimeout(pressTimer)
  pressed = false
  pressTimer = setTimeout(() => {
    pressed = true
    pressedOpen.value = true
    navigator.vibrate?.(10)
  }, 450)
}
const pressEnd = () => clearTimeout(pressTimer)
// The long press opens the actions instead of the browser's menu.
function onContextMenu(e: Event) {
  if (pressed) e.preventDefault()
}
// A touch outside the long-pressed comment hides its actions again.
function onDocumentPointerDown(e: PointerEvent) {
  if (!pickerOpen.value && !el.value?.contains(e.target as Node)) pressedOpen.value = false
}
watch(pressedOpen, (on) => {
  if (on) document.addEventListener('pointerdown', onDocumentPointerDown)
  else document.removeEventListener('pointerdown', onDocumentPointerDown)
})
onBeforeUnmount(() => {
  clearTimeout(pressTimer)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})

const reactedBy = (names: string[], emoji: string) =>
  t('comments.reactedBy', { names: new Intl.ListFormat(locale.value).format(names), emoji }, names.length)
</script>

<template>
  <li
    ref="el"
    :data-comment-id="comment.id"
    class="group/comment -mx-2 flex gap-3 rounded-md px-2 py-1.5 transition-colors pointer-fine:hover:bg-elevated/60 data-active:bg-elevated/60"
    :data-active="pressedOpen || pickerOpen ? '' : undefined"
    @touchstart.passive="pressStart"
    @touchend="pressEnd"
    @touchmove.passive="pressEnd"
    @touchcancel="pressEnd"
    @contextmenu="onContextMenu"
  >
    <UAvatar :src="comment.authorAvatarUrl ?? undefined" :alt="comment.importedAuthor ?? comment.authorName ?? '?'" size="sm" class="shrink-0" />
    <div class="min-w-0 flex-1 space-y-1">
      <div class="flex items-center gap-2 text-xs">
        <span class="font-medium">{{ comment.importedAuthor ?? comment.authorName ?? t('card.formerMember') }}</span>
        <UBadge v-if="comment.importedAuthor" :label="t('comments.imported')" color="neutral" variant="subtle" size="sm" />
        <span class="text-muted">{{ formatDateTime(comment.createdAt, locale) }}</span>
        <span v-if="comment.updatedAt !== comment.createdAt" class="text-dimmed">{{ t('comments.edited') }}</span>
        <!-- Shown on hover, keyboard focus or a long press (touch). -->
        <div class="ms-auto flex opacity-0 transition-opacity pointer-fine:group-hover/comment:opacity-100 group-data-active/comment:opacity-100 has-focus-visible:opacity-100">
          <UPopover v-if="canReact" v-model:open="pickerOpen">
            <UTooltip :text="t('comments.react')">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-smile-plus" :aria-label="t('comments.react')" />
            </UTooltip>
            <template #content>
              <div class="flex gap-0.5 p-1">
                <UButton
                  v-for="e in reactionEmojis"
                  :key="e"
                  size="sm"
                  :color="comment.reactions.some(r => r.emoji === e && r.mine) ? 'primary' : 'neutral'"
                  :variant="comment.reactions.some(r => r.emoji === e && r.mine) ? 'soft' : 'ghost'"
                  :aria-label="e"
                  class="text-lg leading-none"
                  @click="react(e)"
                >
                  {{ e }}
                </UButton>
              </div>
            </template>
          </UPopover>
          <UTooltip v-if="canEdit && mine && editing === null" :text="t('comments.edit')">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t('comments.edit')" @click="editing = comment.body" />
          </UTooltip>
          <UTooltip v-if="canDelete" :text="t('comments.delete')">
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash" :aria-label="t('comments.delete')" @click="cd.deleteComment(comment)" />
          </UTooltip>
        </div>
      </div>
      <form v-if="editing !== null" class="space-y-2" @submit.prevent="saveEdit">
        <MarkdownEditor v-model="editing" :rows="3" :members="members" :upload="cd.upload" />
        <div class="flex justify-end gap-2">
          <UButton size="sm" color="neutral" variant="ghost" :label="t('common.cancel')" @click="editing = null" />
          <UButton type="submit" size="sm" :label="t('common.save')" :disabled="!editing.trim()" />
        </div>
      </form>
      <MarkdownText v-else :text="comment.body" />
      <div v-if="comment.reactions.length" class="flex flex-wrap items-center gap-1 pt-1">
        <UTooltip v-for="r in comment.reactions" :key="r.emoji" :text="reactedBy(r.names, r.emoji)">
          <UButton
            size="xs"
            :color="r.mine ? 'primary' : 'neutral'"
            :variant="r.mine ? 'soft' : 'outline'"
            :disabled="!canReact"
            :aria-pressed="r.mine"
            :aria-label="reactedBy(r.names, r.emoji)"
            class="rounded-full tabular-nums"
            @click="react(r.emoji)"
          >
            <span class="text-sm leading-none">{{ r.emoji }}</span>{{ r.count }}
          </UButton>
        </UTooltip>
      </div>
    </div>
  </li>
</template>
