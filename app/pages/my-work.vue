<script setup lang="ts">
import type { MyWork, MyWorkOptions, MyWorkPanel } from '#shared/types/myWork'
import type { MyWorkPanelConfig } from '#shared/myWork'
import type { MyWorkScope } from '~/utils/myWork'
import { MyWorkPanelModal } from '#components'

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
/** Collapsed panel ids; 'mine' = the classic list. */
const collapsed = ref<string[]>([])
const storeKey = 'kanban:my-work'
onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) ?? '{}') as { scope?: MyWorkScope, showDone?: boolean, collapsed?: unknown }
    if (saved.scope && scopes.includes(saved.scope)) scope.value = saved.scope
    if (typeof saved.showDone === 'boolean') showDone.value = saved.showDone
    if (Array.isArray(saved.collapsed)) collapsed.value = saved.collapsed.filter((x): x is string => typeof x === 'string')
  }
  catch { /* ignore a bad value */ }
  watch([scope, showDone, collapsed], () => localStorage.setItem(storeKey, JSON.stringify({
    scope: scope.value, showDone: showDone.value, collapsed: collapsed.value,
  })), { deep: true })
})
function toggle(id: string) {
  collapsed.value = collapsed.value.includes(id) ? collapsed.value.filter(x => x !== id) : [...collapsed.value, id]
}

const scopeItems = computed(() => scopes.map(s => ({ label: t(`myWork.${s}`), value: s })))
const today = isoDate()
const mine = computed(() => filterMyWork(data.value?.cards ?? [], { scope: scope.value, showDone: showDone.value }))

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
    <div class="flex flex-wrap items-center gap-3">
      <UIcon name="i-lucide-list-checks" class="size-6 text-muted" />
      <div class="me-auto">
        <h1 class="text-2xl font-semibold">
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
    </div>

    <section class="space-y-3 rounded-lg border border-default p-4" :aria-label="t('myWork.yourCards')">
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
        </h2>
        <UTabs v-model="scope" :items="scopeItems" :content="false" size="xs" />
        <USwitch v-model="showDone" :label="t('myWork.showDone')" size="sm" />
      </div>
      <template v-if="!collapsed.includes('mine')">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('myWork.loadFailed')" />
        <UEmpty v-else-if="!mine.length" icon="i-lucide-list-checks" :title="t('myWork.title')" :description="t('myWork.empty')" />
        <MyWorkCardList v-else :cards="mine" :today="today" />
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
      @toggle="toggle(p.id)"
      @edit="editPanel(p)"
      @remove="removePanel(p)"
      @move="dir => movePanel(p, dir)"
    />
    <p v-if="!panels.length" class="text-sm text-muted">
      {{ t('myWork.panels.intro') }}
    </p>
  </UContainer>
</template>
