<script setup lang="ts">
import type { MyWork } from '#shared/types/myWork'
import type { MyWorkScope } from '~/utils/myWork'

const { t } = useI18n()
const i18n = useI18nContext()
useHead({ title: () => t('myWork.title') })

const { data, error, refresh, status } = await useFetch<MyWork>('/api/my-work')

// Scope and "show done" are remembered in localStorage (restored after mount).
const scopes: MyWorkScope[] = ['all', 'assigned', 'watching']
const scope = ref<MyWorkScope>('all')
const showDone = ref(false)
const storeKey = 'kanban:my-work'
onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) ?? '{}') as { scope?: MyWorkScope, showDone?: boolean }
    if (saved.scope && scopes.includes(saved.scope)) scope.value = saved.scope
    if (typeof saved.showDone === 'boolean') showDone.value = saved.showDone
  }
  catch { /* ignore a bad value */ }
  watch([scope, showDone], () => localStorage.setItem(storeKey, JSON.stringify({ scope: scope.value, showDone: showDone.value })))
})

const scopeItems = computed(() => scopes.map(s => ({ label: t(`myWork.${s}`), value: s })))
const today = isoDate()
const groups = computed(() => groupMyWork(filterMyWork(data.value?.cards ?? [], { scope: scope.value, showDone: showDone.value }), today))
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
      <UTabs v-model="scope" :items="scopeItems" :content="false" size="sm" />
      <USwitch v-model="showDone" :label="t('myWork.showDone')" />
      <UTooltip :text="t('myWork.refresh')">
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" :loading="status === 'pending'" :aria-label="t('myWork.refresh')" @click="refresh()" />
      </UTooltip>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('myWork.loadFailed')" />
    <UEmpty v-else-if="!groups.length" icon="i-lucide-list-checks" :title="t('myWork.title')" :description="t('myWork.empty')" />

    <section v-for="g in groups" :key="g.bucket" class="space-y-2">
      <h2 class="flex items-center gap-2 text-sm font-semibold" :class="g.bucket === 'overdue' ? 'text-error' : 'text-muted'">
        {{ t(`myWork.buckets.${g.bucket}`) }}
        <UBadge color="neutral" variant="subtle" size="sm" :label="t('myWork.count', { count: g.cards.length }, g.cards.length)" />
      </h2>
      <ul class="divide-y divide-default rounded-md border border-default">
        <li v-for="c in g.cards" :key="c.id">
          <NuxtLink :to="`/boards/${c.boardId}?card=${c.id}`" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-elevated/50">
            <span class="font-medium truncate" :class="{ 'line-through text-muted': c.done }">{{ c.title }}</span>
            <span class="text-xs text-muted truncate">{{ c.boardName }} › {{ c.columnTitle }}</span>
            <span class="ms-auto flex items-center gap-2">
              <UBadge
                v-if="c.priority"
                :color="priorityMeta[c.priority].color"
                :icon="priorityMeta[c.priority].icon"
                variant="subtle"
                size="sm"
                :label="t(`priority.${c.priority}`)"
              />
              <span v-if="c.startDate || c.dueDate" class="text-xs" :class="g.bucket === 'overdue' && !c.done ? 'text-error' : 'text-muted'">
                {{ formatDateRange(c.startDate, c.dueDate, i18n) }}
              </span>
              <UIcon v-if="c.assigned" name="i-lucide-user-check" class="size-4 text-muted" :aria-label="t('myWork.assignedToYou')" />
              <UIcon v-if="c.watching" name="i-lucide-eye" class="size-4 text-muted" :aria-label="t('myWork.youWatch')" />
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </UContainer>
</template>
