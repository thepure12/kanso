<script setup lang="ts">
import type { Card, CardLink, CardLinkKind, Column } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'

const props = defineProps<{
  items: CardLink[] | null
  cardId: string
  /** The board's unarchived cards and columns, for the picker. */
  cards: Card[]
  columns: Column[]
  canEdit: boolean
  cd: CardDetailApi
}>()
const emit = defineEmits<{
  open: [cardId: string]
  /** A link was added or removed, for the board's "blocked" badges. */
  changed: [link: CardLink, added: boolean]
}>()

const { t } = useI18n()
const groups = computed(() => groupLinks(props.items ?? [], t))
const kindItems = computed(() => linkKindItems(t))

const columnTitle = computed(() => new Map(props.columns.map(c => [c.id, c.title])))
const cardItems = computed(() => props.cards
  .filter(c => c.id !== props.cardId)
  .map(c => ({ label: c.title, value: c.id, description: columnTitle.value.get(c.columnId) })))

const adding = ref(false)
const kind = ref<CardLinkKind>('blocks')
const target = ref<string | undefined>()

async function add() {
  if (!target.value) return
  const link = await props.cd.addLink(target.value, kind.value)
  if (link) emit('changed', link, true)
  target.value = undefined
  adding.value = false
}

function remove(link: CardLink) {
  props.cd.deleteLink(link)
  emit('changed', link, false)
}
</script>

<template>
  <section v-if="props.items && (props.items.length || props.canEdit)" class="space-y-2">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-link" class="size-4 text-dimmed" />
      <h3 class="text-sm font-medium">
        {{ t('cardLinks.title') }}
      </h3>
    </div>
    <div v-for="g in groups" :key="g.label" class="space-y-1">
      <p class="text-xs text-muted">
        {{ g.label }}
      </p>
      <div v-for="l in g.links" :key="l.id" class="group flex items-center gap-2">
        <button
          type="button"
          class="flex-1 min-w-0 flex items-center gap-2 text-start text-sm rounded px-1 py-0.5 hover:bg-elevated cursor-pointer"
          @click="emit('open', l.card.id)"
        >
          <span class="truncate" :class="l.card.archived && 'line-through text-muted'">{{ l.card.title }}</span>
          <UBadge v-if="l.card.archived" color="neutral" variant="subtle" size="sm" :label="t('cardLinks.archived')" />
          <span v-else class="text-xs text-dimmed shrink-0">{{ l.card.columnTitle }}</span>
        </button>
        <UButton
          v-if="props.canEdit"
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          :aria-label="t('cardLinks.remove', { title: l.card.title })"
          class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          @click="remove(l)"
        />
      </div>
    </div>
    <template v-if="props.canEdit">
      <form v-if="adding" class="flex flex-wrap gap-2" @submit.prevent="add">
        <USelect v-model="kind" :items="kindItems" class="w-32" :aria-label="t('cardLinks.kind')" />
        <USelectMenu
          v-model="target"
          :items="cardItems"
          value-key="value"
          :placeholder="t('cardLinks.chooseCard')"
          class="flex-1 min-w-48"
          :aria-label="t('cardLinks.cardToLink')"
        >
          <template #empty>
            {{ t('cardLinks.noCards') }}
          </template>
        </USelectMenu>
        <UButton type="submit" :label="t('cardLinks.link')" :disabled="!target" />
        <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="adding = false" />
      </form>
      <UButton v-else size="sm" color="neutral" variant="ghost" icon="i-lucide-plus" :label="t('cardLinks.add')" @click="adding = true" />
    </template>
  </section>
</template>
