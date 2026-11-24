<script setup lang="ts">
import type { MyWork, MyWorkOptions, MyWorkPanel } from '#shared/types/myWork'
import type { MyWorkPanelConfig } from '#shared/myWork'
import type { MyWorkBucket, MyWorkGroupBy, MyWorkScope } from '~/utils/myWork'
import { MyWorkPanelModal } from '#components'
import { myWorkGroupings } from '~/utils/myWork'

const { t } = useI18n()
const confirm = useConfirm()
const showError = useApiError()
const overlay = useOverlay()
useHead({ title: () => t('myWork.title') })

// The classic list (assigned, watching, checklist items) plus the user's saved panels.
const { data, error, refresh, status } = await useFetch<MyWork>('/api/my-work')
const { data: panelData, refresh: refreshPanels } = await useFetch<MyWorkPanel[]>('/api/my-work/panels', { default: () => [] })
const panels = computed(() => panelData.value ?? [])

// Scope, "show done" and collapsed panels are remembered in localStorage (restored after mount).
const scopes: MyWorkScope[] = ['all', 'assigned', 'watching']
const scope = ref<MyWorkScope>('all')
const showDone = ref(false)
const groupBy = ref<MyWorkGroupBy>('due')
/** Collapsed panel ids; 'mine' = the classic list. */
const collapsed = ref<string[]>([])
const storeKey = 'kanban:my-work'
onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) ?? '{}') as { scope?: MyWorkScope, showDone?: boolean, groupBy?: MyWorkGroupBy, collapsed?: unknown }
    if (saved.scope && scopes.includes(saved.scope)) scope.value = saved.scope
    if (saved.groupBy && myWorkGroupings.includes(saved.groupBy)) groupBy.value = saved.groupBy
    if (typeof saved.showDone === 'boolean') showDone.value = saved.showDone
    if (Array.isArray(saved.collapsed)) collapsed.value = saved.collapsed.filter((x): x is string => typeof x === 'string')
  }
  catch { /* ignore a bad value */ }
  watch([scope, showDone, groupBy, collapsed], () => localStorage.setItem(storeKey, JSON.stringify({
    scope: scope.value, showDone: showDone.value, groupBy: groupBy.value, collapsed: collapsed.value,
  })), { deep: true })
})
function toggle(id: string) {
  collapsed.value = collapsed.value.includes(id) ? collapsed.value.filter(x => x !== id) : [...collapsed.value, id]
}

const scopeItems = computed(() => scopes.map(s => ({ label: t(`myWork.${s}`), value: s })))
const groupItems = computed(() => myWorkGroupings.map(g => ({
  label: t(`myWork.groupBy.${g}`), value: g, icon: g === 'due' ? 'i-lucide-calendar' : 'i-lucide-kanban',
})))
const today = isoDate()

// Search narrows every list on the page; `/` focuses it.
const search = ref('')
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement }>('searchInput')
defineShortcuts({ '/': () => searchInput.value?.inputRef?.focus() })

// The summary tiles count the open cards in the chosen scope and pick a due bucket for "Your cards".
const inScope = computed(() => searchMyWork(filterMyWork(data.value?.cards ?? [], { scope: scope.value, showDone: true }), search.value))
const summary = computed(() => myWorkSummary(inScope.value, today))
const bucket = ref<MyWorkBucket | null>(null)
const tiles = computed(() => ([
  { key: null, label: t('myWork.summary.open'), icon: 'i-lucide-inbox', tone: 'text-highlighted', count: summary.value.open },
  { key: 'overdue', label: t('myWork.buckets.overdue'), icon: 'i-lucide-alarm-clock', tone: 'text-error', count: summary.value.overdue },
  { key: 'today', label: t('myWork.buckets.today'), icon: 'i-lucide-sun', tone: 'text-warning', count: summary.value.today },
  { key: 'soon', label: t('myWork.buckets.soon'), icon: 'i-lucide-calendar-days', tone: 'text-primary', count: summary.value.soon },
] as const))
function pickBucket(key: MyWorkBucket | null) {
  bucket.value = bucket.value === key ? null : key
  collapsed.value = collapsed.value.filter(x => x !== 'mine')
}
const mine = computed(() => inScope.value.filter(c => (showDone.value || !c.done) && (!bucket.value || (!c.done && myWorkBucket(c, today) === bucket.value))))

const { setCompleted } = useMyWorkComplete(
  (id, completed) => { if (data.value) data.value = { cards: withCompleted(data.value.cards, id, completed) } },
  () => refresh(),
)

const reloadKey = ref(0)
const reloading = computed(() => status.value === 'pending')
function reloadAll() {
  refresh()
  refreshPanels()
  reloadKey.value++
}

// Choices for the panel editor, loaded when it first opens.
let options: MyWorkOptions | null = null
async function editPanel(panel?: MyWorkPanel) {
  try {
    options ??= await $fetch<MyWorkOptions>('/api/my-work/options')
  }
  catch (e) {
    showError(e)
    return
  }
  const result = await overlay.create(MyWorkPanelModal, { destroyOnClose: true }).open({ panel, options }).result as { name: string, config: MyWorkPanelConfig } | null
  if (!result) return
  try {
    const saved = panel
      ? await $fetch<MyWorkPanel>(`/api/my-work/panels/${panel.id}`, { method: 'PATCH', body: result })
      : await $fetch<MyWorkPanel>('/api/my-work/panels', { method: 'POST', body: result })
    panelData.value = panel ? panels.value.map(p => p.id === saved.id ? saved : p) : [...panels.value, saved]
    collapsed.value = collapsed.value.filter(x => x !== saved.id)
  }
  catch (e) {
    showError(e)
  }
}

async function removePanel(panel: MyWorkPanel) {
  const ok = await confirm({
    title: t('myWork.panels.deleteTitle', { name: panel.name }),
    confirmLabel: t('myWork.panels.delete'),
    color: 'error',
  })
  if (!ok) return
  try {
    await $fetch(`/api/my-work/panels/${panel.id}`, { method: 'DELETE' })
    panelData.value = panels.value.filter(p => p.id !== panel.id)
    collapsed.value = collapsed.value.filter(x => x !== panel.id)
  }
  catch (e) {
    showError(e)
    refreshPanels()
  }
}

async function movePanel(panel: MyWorkPanel, dir: -1 | 1) {
  const ids = panels.value.map(p => p.id)
  const i = ids.indexOf(panel.id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
  const before = panels.value
  panelData.value = ids.map(id => before.find(p => p.id === id)!)
  try {
    panelData.value = await $fetch<MyWorkPanel[]>('/api/my-work/panels/order', { method: 'PUT', body: { ids } })
  }
  catch (e) {
    showError(e)
    refreshPanels()
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-center gap-3">
      <span class="inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <UIcon name="i-lucide-list-checks" class="size-6" />
      </span>
      <div class="me-auto min-w-0">
        <h1 class="text-2xl font-semibold text-highlighted">
          {{ t('myWork.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ t('myWork.description') }}
        </p>
      </div>
      <UButton icon="i-lucide-plus" :label="t('myWork.panels.add')" @click="editPanel()" />
      <UTooltip :text="t('myWork.refresh')">
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" :loading="reloading" :aria-label="t('myWork.refresh')" @click="reloadAll" />
      </UTooltip>
    </header>

    <div v-if="data" class="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" :aria-label="t('myWork.summary.label')">
      <button
        v-for="tile in tiles"
        :key="tile.key ?? 'open'"
        type="button"
        class="flex items-center gap-3 rounded-xl border p-3 text-start transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :class="bucket === tile.key ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated/50'"
        :aria-pressed="bucket === tile.key"
        @click="pickBucket(tile.key)"
      >
        <UIcon :name="tile.icon" class="size-5 shrink-0" :class="tile.count ? tile.tone : 'text-dimmed'" />
        <span class="min-w-0">
          <span class="block text-2xl font-semibold leading-tight tabular-nums" :class="tile.count ? tile.tone : 'text-dimmed'">{{ tile.count }}</span>
          <span class="block truncate text-xs text-muted">{{ tile.label }}</span>
        </span>
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        ref="searchInput"
        v-model="search"
        icon="i-lucide-search"
        :placeholder="t('myWork.search')"
        :aria-label="t('myWork.search')"
        class="min-w-48 flex-1"
      >
        <template v-if="search" #trailing>
          <UButton icon="i-lucide-x" color="neutral" variant="link" size="sm" :aria-label="t('myWork.clearSearch')" @click="search = ''" />
        </template>
      </UInput>
      <UTabs v-model="groupBy" :items="groupItems" :content="false" size="xs" :aria-label="t('myWork.groupBy.label')" />
    </div>

    <section class="space-y-3 rounded-xl border border-default bg-elevated/25 p-4" :aria-label="t('myWork.yourCards')">
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          :icon="collapsed.includes('mine') ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="collapsed.includes('mine') ? t('myWork.panels.expand') : t('myWork.panels.collapse')"
          :aria-expanded="!collapsed.includes('mine')"
          @click="toggle('mine')"
        />
        <h2 class="font-semibold me-auto">
          {{ t('myWork.yourCards') }}
          <UBadge v-if="data" color="neutral" variant="subtle" size="sm" class="ms-1" :label="t('myWork.count', { count: mine.length }, mine.length)" />
          <UBadge
            v-if="bucket"
            color="primary"
            variant="subtle"
            size="sm"
            class="ms-1 cursor-pointer"
            trailing-icon="i-lucide-x"
            :label="t(`myWork.buckets.${bucket}`)"
            :aria-label="t('myWork.summary.clear')"
            role="button"
            @click="bucket = null"
          />
        </h2>
        <UTabs v-model="scope" :items="scopeItems" :content="false" size="xs" />
        <USwitch v-model="showDone" :label="t('myWork.showDone')" size="sm" />
      </div>
      <template v-if="!collapsed.includes('mine')">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('myWork.loadFailed')" />
        <UEmpty v-else-if="!mine.length && (search.trim() || bucket)" icon="i-lucide-search-x" :title="t('myWork.noMatches')" />
        <UEmpty v-else-if="!mine.length" icon="i-lucide-party-popper" :title="t('myWork.allClear')" :description="t('myWork.empty')" />
        <MyWorkCardList v-else :cards="mine" :today="today" :group-by="groupBy" @complete="(c, done) => setCompleted(c, done)" />
      </template>
    </section>

    <MyWorkPanelView
      v-for="(p, i) in panels"
      :key="p.id"
      :panel="p"
      :today="today"
      :collapsed="collapsed.includes(p.id)"
      :first="i === 0"
      :last="i === panels.length - 1"
      :reload-key="reloadKey"
      :search="search"
      :group-by="groupBy"
      @toggle="toggle(p.id)"
      @edit="editPanel(p)"
      @remove="removePanel(p)"
      @move="dir => movePanel(p, dir)"
    />
    <div v-if="!panels.length" class="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-default p-4">
      <UIcon name="i-lucide-layout-list" class="size-5 text-muted" />
      <p class="flex-1 text-sm text-muted">
        {{ t('myWork.panels.intro') }}
      </p>
      <UButton icon="i-lucide-plus" color="neutral" variant="outline" size="sm" :label="t('myWork.panels.add')" @click="editPanel()" />
    </div>
  </UContainer>
</template>
