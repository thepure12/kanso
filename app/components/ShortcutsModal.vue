<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
</script>

<template>
  <UModal v-model:open="open" :title="t('shortcuts.title')">
    <template #body>
      <div class="space-y-6">
        <section v-for="group in shortcutGroups" :key="group.label">
          <h3 class="text-sm font-medium text-muted mb-2">
            {{ t(group.label) }}
          </h3>
          <ul class="divide-y divide-default">
            <li v-for="s in group.items" :key="s.description" class="flex items-center justify-between gap-4 py-2 text-sm">
              <span>{{ t(s.description) }}</span>
              <span class="flex items-center gap-1 shrink-0">
                <template v-for="(k, i) in s.kbds" :key="k">
                  <span v-if="s.sequence && i > 0" class="text-xs text-muted">{{ t('shortcuts.then') }}</span>
                  <UKbd :value="k" />
                </template>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </UModal>
</template>
