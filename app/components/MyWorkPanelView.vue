<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MyWork, MyWorkCard, MyWorkPanel } from '#shared/types/myWork'
import { myWorkQuery } from '#shared/myWork'
import type { MyWorkGroupBy } from '~/utils/myWork'

// One saved My work panel: loads its cards (GET /api/my-work with the panel's
// query), filters due and done locally and lists them read-only.
const props = defineProps<{
  panel: MyWorkPanel
  today: string
  collapsed: boolean
  first: boolean
  last: boolean
  /** Bumped by the page's refresh button. */
  reloadKey: number
  /** The page's search text. */
  search?: string
  groupBy?: MyWorkGroupBy
}>()
const emit = defineEmits<{ edit: [], remove: [], move: [dir: -1 | 1], toggle: [] }>()
const { t } = useI18n()

const cards = ref<MyWorkCard[] | null>(null)
const failed = ref(false)
const loading = ref(false)
let request = 0

async function load() {
  const mine = ++request
  loading.value = true
  try {
    const res = await $fetch<MyWork>('/api/my-work', { query: myWorkQuery(props.panel.config) })
    if (mine !== request) return
    cards.value = res.cards
    failed.value = false
  }
  catch {
    if (mine === request) failed.value = true
  }
  finally {
    if (mine === request) loading.value = false
  }
}
onMounted(load)
watch(() => [props.panel.config, props.reloadKey], load, { deep: true })

const shown = computed(() => searchMyWork(filterPanelCards(cards.value ?? [], props.panel.config, props.today), props.search ?? ''))
const { setCompleted } = useMyWorkComplete(
  (id, completed) => { if (cards.value) cards.value = withCompleted(cards.value, id, completed) },
  load,
)
/** Avatars help when the panel is not only about the user's own cards. */
const showAssignees = computed(() => props.panel.config.people === 'anyone' || props.panel.config.people === 'people')

const menu = computed<DropdownMenuItem[][]>(() => [[
  { label: t('myWork.panels.edit'), icon: 'i-lucide-pencil', onSelect: () => emit('edit') },
  { label: t('myWork.panels.moveUp'), icon: 'i-lucide-arrow-up', disabled: props.first, onSelect: () => emit('move', -1) },
  { label: t('myWork.panels.moveDown'), icon: 'i-lucide-arrow-down', disabled: props.last, onSelect: () => emit('move', 1) },
], [
  { label: t('myWork.panels.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('remove') },
]])
</script>

<template>
  <section class="space-y-3 rounded-xl border border-default bg-elevated/25 p-4" :aria-label="panel.name">
    <div class="flex items-center gap-2">
      <UButton
        :icon="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
        color="neutral"
        variant="ghost"
        size="sm"
        :aria-label="collapsed ? t('myWork.panels.expand') : t('myWork.panels.collapse')"
        :aria-expanded="!collapsed"
        @click="emit('toggle')"
      />
      <UIcon name="i-lucide-layout-list" class="size-4 shrink-0 text-muted" />
      <h2 class="font-semibold truncate">
        {{ panel.name }}
      </h2>
      <UBadge v-if="cards" color="neutral" variant="subtle" size="sm" :label="t('myWork.count', { count: shown.length }, shown.length)" />
      <UIcon v-if="loading" name="i-lucide-loader-circle" class="size-4 animate-spin text-muted" />
      <UDropdownMenu :items="menu" :content="{ align: 'end' }">
        <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" class="ms-auto" :aria-label="t('myWork.panels.actions', { name: panel.name })" />
      </UDropdownMenu>
    </div>
    <template v-if="!collapsed">
      <UAlert v-if="failed" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('myWork.loadFailed')" />
      <p v-else-if="cards && !shown.length" class="text-sm text-muted">
        {{ search?.trim() ? t('myWork.noMatches') : t('myWork.panels.empty') }}
      </p>
      <MyWorkCardList
        v-else-if="cards"
        :cards="shown"
        :today="today"
        :group-by="groupBy"
        :show-assignees="showAssignees"
        @complete="(c, done) => setCompleted(c, done)"
      />
    </template>
  </section>
</template>
