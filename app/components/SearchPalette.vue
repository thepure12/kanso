<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import type { BoardSummary } from '#shared/types/board'
import type { SearchResults } from '#shared/types/search'

const props = defineProps<{ isAdmin: boolean }>()
const open = defineModel<boolean>('open', { required: true })

const term = ref('')
const results = ref<SearchResults | null>(null)
const searching = ref(false)
const boards = ref<BoardSummary[]>([])
const colorMode = useColorMode()
const { t } = useI18n()

// The board list (shown before typing) is reloaded each time the palette opens.
watch(open, async (isOpen) => {
  if (!isOpen) return
  term.value = ''
  try { boards.value = await $fetch<BoardSummary[]>('/api/boards') }
  catch { boards.value = [] }
}, { immediate: true })

// Debounced server search; a late response for an older term is dropped.
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0
watch(term, (q) => {
  clearTimeout(timer)
  const mine = ++seq
  if (!q.trim()) {
    results.value = null
    searching.value = false
    return
  }
  searching.value = true
  timer = setTimeout(async () => {
    try {
      const res = await $fetch<SearchResults>('/api/search', { query: { q } })
      if (mine === seq) results.value = res
    }
    catch { if (mine === seq) results.value = null }
    finally { if (mine === seq) searching.value = false }
  }, 200)
})
onBeforeUnmount(() => clearTimeout(timer))

function go(to: string) {
  open.value = false
  return navigateTo(to)
}

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  const r = results.value
  const searched = !!term.value.trim()
  // Starred boards first (stable sort keeps the server's order otherwise), archived ones last.
  const known = new Map(boards.value.map(b => [b.id, b]))
  const rank = (id: string) => known.get(id)?.starred ? 0 : known.get(id)?.archivedAt ? 2 : 1
  const boardItems = [...(searched ? r?.boards ?? [] : boards.value)].sort((a, b) => rank(a.id) - rank(b.id)).map(b => ({
    id: `board-${b.id}`,
    label: b.name,
    icon: known.get(b.id)?.starred ? 'i-lucide-star' : 'i-lucide-square-kanban',
    suffix: known.get(b.id)?.archivedAt ? t('search.archived') : undefined,
    onSelect: () => go(`/boards/${b.id}`),
  }))
  const actions: CommandPaletteItem[] = [
    { id: 'new-board', label: t('search.newBoard'), icon: 'i-lucide-plus', onSelect: () => go('/?new=board') },
    { id: 'home', label: t('search.allBoards'), icon: 'i-lucide-house', kbds: ['g', 'h'], onSelect: () => go('/') },
    { id: 'my-work', label: t('search.myWork'), icon: 'i-lucide-list-checks', kbds: ['g', 'm'], onSelect: () => go('/my-work') },
    { id: 'account', label: t('search.account'), icon: 'i-lucide-user-cog', onSelect: () => go('/account') },
    ...(props.isAdmin ? [{ id: 'admin', label: t('search.admin'), icon: 'i-lucide-shield', onSelect: () => go('/admin') }] : []),
    {
      id: 'color-mode',
      label: colorMode.value === 'dark' ? t('search.lightMode') : t('search.darkMode'),
      icon: colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon',
      onSelect: () => { colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark' },
    },
  ]
  return [
    // Server results are already matched and ranked: no client-side filtering.
    ...(searched
      ? [
          {
            id: 'cards',
            label: t('search.cards'),
            ignoreFilter: true,
            items: (r?.cards ?? []).map(c => ({
              id: `card-${c.id}`,
              label: c.title,
              suffix: c.archived ? t('search.cardArchived', { path: `${c.boardName} › ${c.columnName}` }) : `${c.boardName} › ${c.columnName}`,
              description: c.snippet ?? undefined,
              icon: c.inComment ? 'i-lucide-message-square' : 'i-lucide-sticky-note',
              onSelect: () => go(`/boards/${c.boardId}?card=${c.id}`),
            })),
          },
          {
            id: 'columns',
            label: t('search.columns'),
            ignoreFilter: true,
            items: (r?.columns ?? []).map(c => ({
              id: `column-${c.id}`, label: c.title, suffix: c.boardName, icon: 'i-lucide-columns-3', onSelect: () => go(`/boards/${c.boardId}`),
            })),
          },
        ]
      : []),
    { id: 'boards', label: t('search.boards'), ignoreFilter: searched, items: boardItems },
    { id: 'actions', label: t('search.actions'), items: actions },
  ]
})
</script>

<template>
  <UModal v-model:open="open" :title="t('search.title')" :description="t('search.description')" :ui="{ content: 'sm:max-w-2xl' }">
    <template #content>
      <UCommandPalette
        v-model:search-term="term"
        :groups="groups"
        :loading="searching"
        :placeholder="t('search.placeholder')"
        class="h-[28rem] max-h-[80vh]"
        close
        @update:open="open = $event"
      />
    </template>
  </UModal>
</template>
