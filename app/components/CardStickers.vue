<script setup lang="ts">
import { STICKERS_MAX, stickerEmojis, toggleSticker, type StickerEmoji } from '#shared/stickers'

// Emoji stickers on a card's front. Editors add them from a picker and click
// one to take it off; each change is saved at once (emitted as the new list).
const props = defineProps<{
  stickers: string[]
  canEdit: boolean
}>()
const emit = defineEmits<{ update: [stickers: string[]] }>()
const { t } = useI18n()

const full = computed(() => props.stickers.length >= STICKERS_MAX)

function toggle(emoji: StickerEmoji) {
  const next = toggleSticker(props.stickers, emoji)
  if (next) emit('update', next)
}
function remove(emoji: string) {
  emit('update', props.stickers.filter(s => s !== emoji))
}
</script>

<template>
  <div v-if="props.stickers.length || props.canEdit" class="flex flex-wrap items-center gap-1" role="group" :aria-label="t('stickers.label')">
    <template v-for="s in props.stickers" :key="s">
      <UTooltip v-if="props.canEdit" :text="t('stickers.remove')">
        <button
          type="button"
          class="text-2xl leading-none rounded-md p-0.5 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="t('stickers.removeOne', { emoji: s })"
          @click="remove(s)"
        >
          {{ s }}
        </button>
      </UTooltip>
      <span v-else class="text-2xl leading-none p-0.5" role="img">{{ s }}</span>
    </template>
    <UPopover v-if="props.canEdit" :content="{ align: 'start' }">
      <UButton
        icon="i-lucide-sticker"
        :label="props.stickers.length ? undefined : t('stickers.add')"
        :aria-label="t('stickers.add')"
        :title="t('stickers.add')"
        color="neutral"
        variant="ghost"
        size="sm"
      />
      <template #content>
        <div class="p-2 w-64 space-y-2">
          <div class="grid grid-cols-7 gap-1">
            <button
              v-for="e in stickerEmojis"
              :key="e"
              type="button"
              class="text-xl leading-none rounded-md p-1 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 disabled:cursor-not-allowed"
              :class="props.stickers.includes(e) && 'bg-primary/15 ring ring-primary/50'"
              :aria-pressed="props.stickers.includes(e)"
              :aria-label="e"
              :disabled="full && !props.stickers.includes(e)"
              @click="toggle(e)"
            >
              {{ e }}
            </button>
          </div>
          <p class="text-xs text-muted">
            {{ full ? t('stickers.full', { max: STICKERS_MAX }) : t('stickers.hint') }}
          </p>
        </div>
      </template>
    </UPopover>
  </div>
</template>
