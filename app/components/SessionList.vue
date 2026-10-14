<script setup lang="ts">
import type { AccountSession } from '#shared/types/account'

const { clear } = useUserSession()
const showError = useApiError()
const toast = useToast()
const { t, locale } = useI18n()

const { data: sessions, refresh } = await useFetch<AccountSession[]>('/api/account/sessions', { default: () => [] })
const others = computed(() => sessions.value.filter(s => !s.current).length)

async function revoke(s: AccountSession) {
  try {
    const res = await $fetch<{ current: boolean }>(`/api/account/sessions/${s.id}`, { method: 'DELETE' })
    if (res.current) {
      await clear()
      return await navigateTo('/login')
    }
  }
  catch (err) { showError(err, t('sessions.revokeFailed')) }
  await refresh()
}

async function revokeOthers() {
  try {
    const res = await $fetch<{ revoked: number }>('/api/account/sessions/revoke-others', { method: 'POST' })
    toast.add({ title: t('sessions.revoked', {}, res.revoked), color: 'success' })
  }
  catch (err) { showError(err, t('sessions.revokeOthersFailed')) }
  await refresh()
}

defineExpose({ refresh })
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-lg font-medium">
        {{ t('sessions.title') }}
      </h2>
      <UButton
        v-if="others"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-log-out"
        :label="t('sessions.signOutOthers')"
        @click="revokeOthers"
      />
    </div>
    <ul class="divide-y divide-default">
      <li v-for="s in sessions" :key="s.id" class="flex items-center gap-3 py-3">
        <UIcon :name="deviceIcon(s.userAgent)" class="size-5 text-muted shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium">
            {{ describeUserAgent(s.userAgent, t) }}
            <UBadge v-if="s.current" color="primary" variant="subtle" size="sm" :label="t('sessions.thisDevice')" class="ms-1" />
          </p>
          <p class="text-xs text-muted truncate">
            {{ t('sessions.details', { ip: s.ip ?? t('sessions.unknownIp'), lastSeen: formatDateTime(s.lastSeenAt, locale), created: formatDateTime(s.createdAt, locale) }) }}
          </p>
        </div>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :label="s.current ? t('sessions.signOut') : t('sessions.revoke')"
          @click="revoke(s)"
        />
      </li>
    </ul>
  </section>
</template>
