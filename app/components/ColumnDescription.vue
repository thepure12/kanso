<script setup lang="ts">
// Info button in a column header; opens the column's description (Markdown).
const props = defineProps<{ title: string, description: string, coloured?: boolean }>()
const { t } = useI18n()
</script>

<template>
  <UPopover :content="{ align: 'start' }">
    <UTooltip :text="t('columnEdit.showDescription')">
      <UButton
        icon="i-lucide-info"
        size="xs"
        color="neutral"
        variant="ghost"
        class="pointer-coarse:p-1.5"
        :class="props.coloured && 'text-inherit hover:bg-black/10'"
        :aria-label="t('columnEdit.showDescriptionOf', { title: props.title })"
      />
    </UTooltip>
    <template #content>
      <div class="max-w-sm max-h-80 overflow-y-auto p-3 text-sm">
        <MarkdownText :text="props.description" />
      </div>
    </template>
  </UPopover>
</template>
