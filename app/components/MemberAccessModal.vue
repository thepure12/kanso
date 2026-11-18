<script setup lang="ts">
import type { BoardAccess, Card, Column, Member, MemberAccess } from '#shared/types/board'

// Owner dialog limiting a non-owner to columns and cards: a default access plus
// per-column and per-card overrides (none | read | edit). The server enforces it (RLS).
const props = defineProps<{
  member: Member
  columns: Column[]
  cards: Card[]
  /** Current limits; null = not limited. */
  access: MemberAccess | null
  saving?: boolean
}>()
const emit = defineEmits<{ save: [access: MemberAccess], remove: [] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const INHERIT = 'inherit'
type Choice = BoardAccess | typeof INHERIT

const defaultAccess = ref<BoardAccess>('none')
const columnChoice = ref<Record<string, Choice>>({})
const cardEntries = ref<{ id: string, access: BoardAccess }[]>([])
const pickedCard = ref<string | undefined>()

watch(open, (isOpen) => {
  if (!isOpen) return
  const a = props.access
  // Not limited yet: start from what the member has now, so the dialog shows their real access.
  defaultAccess.value = a?.defaultAccess ?? (readOnlyRole(props.member.role) ? 'read' : 'edit')
  columnChoice.value = Object.fromEntries(props.columns.map(c => [c.id, a?.columns[c.id] ?? INHERIT]))
  cardEntries.value = Object.entries(a?.cards ?? {})
    .filter(([id]) => props.cards.some(c => c.id === id))
    .map(([id, access]) => ({ id, access }))
  pickedCard.value = undefined
}, { immediate: true })

const isViewer = computed(() => readOnlyRole(props.member.role))
const accessItems = computed(() => (['none', 'read', 'edit'] as const)
  .filter(v => !isViewer.value || v !== 'edit')
  .map(value => ({ label: t(`memberAccess.levels.${value}`), value })))
const columnItems = computed(() => [
  { label: t('memberAccess.inherit', { level: t(`memberAccess.levels.${defaultAccess.value}`) }), value: INHERIT },
  ...accessItems.value,
])
const cardTitle = (id: string) => props.cards.find(c => c.id === id)?.title ?? ''
const cardColumn = (id: string) => {
  const card = props.cards.find(c => c.id === id)
  return props.columns.find(c => c.id === card?.columnId)?.title ?? ''
}
const cardItems = computed(() => props.cards
  .filter(c => !cardEntries.value.some(e => e.id === c.id))
  .map(c => ({ label: c.title, value: c.id, description: props.columns.find(col => col.id === c.columnId)?.title })))

function addCard(id: string | undefined) {
  if (!id) return
  cardEntries.value.push({ id, access: isViewer.value ? 'read' : 'edit' })
  nextTick(() => { pickedCard.value = undefined })
}

function save() {
  emit('save', {
    defaultAccess: defaultAccess.value,
    columns: Object.fromEntries(Object.entries(columnChoice.value).filter(([, v]) => v !== INHERIT)) as Record<string, BoardAccess>,
    cards: Object.fromEntries(cardEntries.value.map(e => [e.id, e.access])),
  })
}
</script>

<template>
  <UModal v-model:open="open" :title="t('memberAccess.title', { name: props.member.name })" :description="t('memberAccess.description')" :ui="{ content: 'max-w-xl' }">
    <template #body>
      <div class="space-y-5">
        <UAlert v-if="isViewer" color="neutral" variant="subtle" icon="i-lucide-eye" :description="t('memberAccess.viewerNote')" />

        <UFormField :label="t('memberAccess.default')" :help="t('memberAccess.defaultHelp')">
          <USelect v-model="defaultAccess" :items="accessItems" class="w-full" />
        </UFormField>

        <section class="space-y-2">
          <h3 class="text-sm font-medium">
            {{ t('memberAccess.columns') }}
          </h3>
          <div v-for="col in props.columns" :key="col.id" class="flex items-center gap-3">
            <span class="flex-1 min-w-0 truncate text-sm">{{ col.title }}</span>
            <USelect v-model="columnChoice[col.id]!" :items="columnItems" size="sm" class="w-48" :aria-label="col.title" />
          </div>
        </section>

        <section class="space-y-2">
          <h3 class="text-sm font-medium">
            {{ t('memberAccess.cards') }}
          </h3>
          <p class="text-xs text-muted">
            {{ t('memberAccess.cardsHelp') }}
          </p>
          <div v-for="(entry, i) in cardEntries" :key="entry.id" class="flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="truncate text-sm">
                {{ cardTitle(entry.id) }}
              </div>
              <div class="truncate text-xs text-muted">
                {{ cardColumn(entry.id) }}
              </div>
            </div>
            <USelect v-model="entry.access" :items="accessItems" size="sm" class="w-36" :aria-label="cardTitle(entry.id)" />
            <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-x" :aria-label="t('common.remove')" @click="cardEntries.splice(i, 1)" />
          </div>
          <USelectMenu
            v-model="pickedCard"
            :items="cardItems"
            value-key="value"
            :placeholder="t('memberAccess.addCard')"
            icon="i-lucide-plus"
            class="w-full"
            @update:model-value="addCard"
          />
        </section>

        <div class="flex justify-between gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-shield-off"
            :label="t('memberAccess.remove')"
            :disabled="!props.access || props.saving"
            @click="emit('remove')"
          />
          <UButton :label="t('common.save')" :loading="props.saving" @click="save" />
        </div>
      </div>
    </template>
  </UModal>
</template>
