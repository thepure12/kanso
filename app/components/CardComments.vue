<script setup lang="ts">
import type { Comment, Member } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'
import { reactionEmojis } from '#shared/reactions'

const props = defineProps<{
  items: Comment[] | null
  canEdit: boolean
  isOwner: boolean
  /** Viewers may react too; false while the board is archived or offline. */
  canReact: boolean
  cd: CardDetailApi
  members: Member[]
}>()
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

const pickerFor = ref<string | null>(null)
function react(c: Comment, emoji: string) {
  pickerFor.value = null
  props.cd.toggleReaction(c, emoji, user.value?.name ?? '')
}
// The comment whose actions show: hovered (CSS), long-pressed on touch, or with its picker open.
const activeId = ref<string | null>(null)
let pressTimer: ReturnType<typeof setTimeout> | undefined
let pressed = false
function pressStart(c: Comment) {
  clearTimeout(pressTimer)
  pressed = false
  pressTimer = setTimeout(() => {
    pressed = true
    activeId.value = c.id
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
  const id = (e.target as Element | null)?.closest?.('[data-comment-id]')?.getAttribute('data-comment-id')
  if (activeId.value && !pickerFor.value && id !== activeId.value) activeId.value = null
}
onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))

const reactedBy = (names: string[], emoji: string) =>
  t('comments.reactedBy', { names: new Intl.ListFormat(locale.value).format(names), emoji }, names.length)
</script>

<template>
  <div class="space-y-4 pt-2">
    <form v-if="props.canEdit" class="space-y-2" @submit.prevent="post">
      <MarkdownEditor v-model="draft" :rows="3" :members="props.members" :upload="props.cd.upload" :placeholder="t('comments.placeholder')" />
      <div class="flex justify-end">
        <UButton type="submit" size="sm" :label="t('comments.submit')" :disabled="!draft.trim()" />
      </div>
    </form>
    <USkeleton v-if="!props.items" class="h-12 w-full" />
    <p v-else-if="!props.items.length" class="text-sm text-muted">
      {{ t('comments.empty') }}
    </p>
    <ul v-else class="space-y-2">
      <li
        v-for="c in [...props.items].reverse()"
        :key="c.id"
        :data-comment-id="c.id"
        class="group/comment -mx-2 flex gap-3 rounded-md px-2 py-1.5 transition-colors pointer-fine:hover:bg-elevated/60 data-active:bg-elevated/60"
        :data-active="activeId === c.id || pickerFor === c.id ? '' : undefined"
        @touchstart.passive="pressStart(c)"
        @touchend="pressEnd"
        @touchmove.passive="pressEnd"
        @touchcancel="pressEnd"
        @contextmenu="onContextMenu"
      >
        <UAvatar :src="c.authorAvatarUrl ?? undefined" :alt="c.importedAuthor ?? c.authorName ?? '?'" size="sm" class="shrink-0" />
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-center gap-2 text-xs">
            <span class="font-medium">{{ c.importedAuthor ?? c.authorName ?? t('card.formerMember') }}</span>
            <UBadge v-if="c.importedAuthor" :label="t('comments.imported')" color="neutral" variant="subtle" size="sm" />
            <span class="text-muted">{{ formatDateTime(c.createdAt, locale) }}</span>
            <span v-if="c.updatedAt !== c.createdAt" class="text-dimmed">{{ t('comments.edited') }}</span>
            <!-- Shown on hover, keyboard focus or a long press (touch). -->
            <div class="ms-auto flex opacity-0 transition-opacity pointer-fine:group-hover/comment:opacity-100 group-data-active/comment:opacity-100 has-focus-visible:opacity-100">
              <UPopover v-if="props.canReact" :open="pickerFor === c.id" @update:open="pickerFor = $event ? c.id : null">
                <UTooltip :text="t('comments.react')">
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-smile-plus" :aria-label="t('comments.react')" />
                </UTooltip>
                <template #content>
                  <div class="flex gap-0.5 p-1">
                    <UButton
                      v-for="e in reactionEmojis"
                      :key="e"
                      size="sm"
                      :color="c.reactions.some(r => r.emoji === e && r.mine) ? 'primary' : 'neutral'"
                      :variant="c.reactions.some(r => r.emoji === e && r.mine) ? 'soft' : 'ghost'"
                      :aria-label="e"
                      class="text-lg leading-none"
                      @click="react(c, e)"
                    >
                      {{ e }}
                    </UButton>
                  </div>
                </template>
              </UPopover>
              <UTooltip v-if="props.canEdit && mine(c) && editing?.id !== c.id" :text="t('comments.edit')">
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t('comments.edit')" @click="editing = { id: c.id, body: c.body }" />
              </UTooltip>
              <UTooltip v-if="canDelete(c)" :text="t('comments.delete')">
                <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash" :aria-label="t('comments.delete')" @click="props.cd.deleteComment(c)" />
              </UTooltip>
            </div>
          </div>
          <form v-if="editing?.id === c.id" class="space-y-2" @submit.prevent="saveEdit(c)">
            <MarkdownEditor v-model="editing.body" :rows="3" :members="props.members" :upload="props.cd.upload" />
            <div class="flex justify-end gap-2">
              <UButton size="sm" color="neutral" variant="ghost" :label="t('common.cancel')" @click="editing = null" />
              <UButton type="submit" size="sm" :label="t('common.save')" :disabled="!editing.body.trim()" />
            </div>
          </form>
          <MarkdownText v-else :text="c.body" />
          <div v-if="c.reactions.length" class="flex flex-wrap items-center gap-1 pt-1">
            <UTooltip v-for="r in c.reactions" :key="r.emoji" :text="reactedBy(r.names, r.emoji)">
              <UButton
                size="xs"
                :color="r.mine ? 'primary' : 'neutral'"
                :variant="r.mine ? 'soft' : 'outline'"
                :disabled="!props.canReact"
                :aria-pressed="r.mine"
                :aria-label="reactedBy(r.names, r.emoji)"
                class="rounded-full tabular-nums"
                @click="react(c, r.emoji)"
              >
                <span class="text-sm leading-none">{{ r.emoji }}</span>{{ r.count }}
              </UButton>
            </UTooltip>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
