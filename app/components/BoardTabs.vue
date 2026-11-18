<script setup lang="ts">
/**
 * Tab strip of the boards open on this device (`useBoardTabs`), shown above the
 * board header once two or more are open. Middle-click or the x closes a tab;
 * closing the current one opens its neighbour (or the home page).
 */
const props = defineProps<{ activeId: string }>()
const { t } = useI18n()
const { tabs, forget } = useBoardTabs()

function close(id: string) {
  const next = forget(id)
  if (id === props.activeId) navigateTo(next ? `/boards/${next}` : '/')
}

function onAuxClick(e: MouseEvent, id: string) {
  if (e.button !== 1) return
  e.preventDefault()
  close(id)
}

// Keep the current tab in view when the strip scrolls.
const strip = useTemplateRef<HTMLElement>('strip')
onMounted(() => nextTick(() => {
  strip.value?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}))
</script>

<template>
  <nav v-if="tabs.length > 1" :aria-label="t('boardTabs.label')" class="border-b border-default">
    <ul ref="strip" class="flex items-end gap-1 overflow-x-auto px-2 sm:px-6 pt-1.5 [scrollbar-width:thin]">
      <li
        v-for="tab in tabs"
        :key="tab.id"
        class="group/tab flex items-center shrink-0 max-w-56 rounded-t-md border border-b-0 text-sm"
        :class="tab.id === activeId ? 'bg-default border-default text-highlighted font-medium -mb-px pb-px' : 'border-transparent text-muted hover:bg-elevated/60 hover:text-default'"
        @auxclick="onAuxClick($event, tab.id)"
      >
        <NuxtLink
          :to="`/boards/${tab.id}`"
          class="truncate ps-3 py-1 focus-visible:outline-2 focus-visible:outline-primary rounded-sm"
          :aria-current="tab.id === activeId ? 'page' : undefined"
          :title="tab.name"
        >
          {{ tab.name }}
        </NuxtLink>
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="link"
          class="mx-0.5 p-0.5"
          :class="tab.id !== activeId && 'pointer-fine:opacity-0 pointer-fine:group-hover/tab:opacity-100 focus-visible:opacity-100'"
          :aria-label="t('boardTabs.close', { name: tab.name })"
          @click="close(tab.id)"
        />
      </li>
    </ul>
  </nav>
</template>
