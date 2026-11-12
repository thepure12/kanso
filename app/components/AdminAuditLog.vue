<script setup lang="ts">
import type { AuditLogPage } from '#shared/types/admin'

const { t, locale } = useI18n()
const i18n = useI18nContext()
const page = ref(1)
const { data, refresh } = await useFetch<AuditLogPage>('/api/admin/audit-log', { query: { page } })

/** Settings changes, "allowed domains: a.org → a.org, b.org". */
function changeLines(changes: unknown): string[] {
  const show = (v: unknown) => Array.isArray(v) ? (v.join(', ') || t('audit.none')) : String(v)
  return Object.entries((changes ?? {}) as Record<string, { from: unknown, to: unknown }>)
    .map(([k, c]) => `${auditSettingLabel(k, i18n.t)}: ${show(c.from)} → ${show(c.to)}`)
}

defineExpose({ refresh })
</script>

<template>
  <section class="space-y-2">
    <p v-if="!data?.entries.length" class="text-sm text-muted">
      {{ t('audit.empty') }}
    </p>
    <ul v-else class="divide-y divide-default">
      <li v-for="e in data.entries" :key="e.id" class="py-2 text-sm">
        <div class="flex items-baseline justify-between gap-3">
          <span>{{ auditText(e, i18n.t) }}</span>
          <time class="text-xs text-muted shrink-0" :datetime="e.createdAt">{{ formatDateTime(e.createdAt, locale) }}</time>
        </div>
        <p v-for="line in changeLines(e.data.changes)" :key="line" class="text-xs text-muted break-all">
          {{ line }}
        </p>
      </li>
    </ul>
    <UPagination
      v-if="data && data.total > data.pageSize"
      v-model:page="page"
      :total="data.total"
      :items-per-page="data.pageSize"
    />
  </section>
</template>
