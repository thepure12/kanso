<script setup lang="ts">
import type { Me } from '#shared/types/account'

const { loggedIn, user, clear } = useUserSession()
const { t, locale, setLocale } = useI18n()
const { $pwa } = useNuxtApp()

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await clear()
  await navigateTo('/login')
}

// Cosmetic only: /api/admin/* checks admin rights in the database.
const { data: me } = useFetch<Me>('/api/me', { key: 'me', immediate: loggedIn.value, watch: [loggedIn] })

// The saved language wins over the cookie and browser (null: keep those).
// Applied after hydration; setLocale also updates the cookie, so the next
// server render on this device already uses it.
onMounted(() => watch(() => me.value?.locale, (saved) => {
  if (saved && saved !== locale.value) setLocale(saved)
}, { immediate: true }))

// Phones hide the header's colour mode button; the user menu offers it instead.
const colorMode = useColorMode()
const menu = computed(() => [
  [{ label: user.value?.email, type: 'label' as const }],
  [{ label: t('nav.account'), icon: 'i-lucide-user-cog', to: '/account' }],
  ...(me.value?.isAdmin ? [[{ label: t('nav.admin'), icon: 'i-lucide-shield', to: '/admin' }]] : []),
  [
    colorMode.value === 'dark'
      ? { label: t('nav.lightMode'), icon: 'i-lucide-sun', class: 'sm:hidden', onSelect: () => { colorMode.preference = 'light' } }
      : { label: t('nav.darkMode'), icon: 'i-lucide-moon', class: 'sm:hidden', onSelect: () => { colorMode.preference = 'dark' } },
    { label: t('nav.shortcuts'), icon: 'i-lucide-keyboard', kbds: ['?'], onSelect: () => { shortcutsOpen.value = true } },
    // Offered once the browser fires beforeinstallprompt (production builds, not yet installed).
    ...($pwa?.showInstallPrompt && !$pwa.isPWAInstalled ? [{ label: t('nav.install'), icon: 'i-lucide-monitor-down', onSelect: () => { $pwa.install() } }] : []),
  ],
  [{ label: t('nav.signOut'), icon: 'i-lucide-log-out', onSelect: logout }],
])

// Global shortcuts (listed in app/utils/shortcuts.ts). Ctrl/Cmd+K works while
// typing too; the others skip inputs (defineShortcuts) and open dialogs.
const paletteOpen = ref(false)
const shortcutsOpen = ref(false)
defineShortcuts(computed(() => loggedIn.value
  ? {
      meta_k: { usingInput: true, handler: () => { paletteOpen.value = !paletteOpen.value } },
      '?': () => { if (!dialogOpen()) shortcutsOpen.value = true },
      'g-h': () => { if (!dialogOpen()) navigateTo('/') },
      'g-m': () => { if (!dialogOpen()) navigateTo('/my-work') },
    }
  : {}))
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <UHeader :toggle="false" :ui="{ container: 'max-w-none px-3 sm:px-4 lg:px-6' }">
      <template #title>
        <AppLogo />
      </template>
      <template #right>
        <UButton v-if="loggedIn" color="neutral" variant="outline" icon="i-lucide-search" :aria-label="t('nav.search')" class="text-muted" @click="paletteOpen = true">
          <span class="hidden sm:inline me-4">{{ t('nav.search') }}</span>
          <span class="hidden sm:flex gap-0.5">
            <UKbd value="meta" />
            <UKbd value="k" />
          </span>
        </UButton>
        <UTooltip v-if="loggedIn" :text="t('nav.myWork')" :kbds="['g', 'm']">
          <UButton to="/my-work" color="neutral" variant="ghost" icon="i-lucide-list-checks" :aria-label="t('nav.myWork')">
            <span class="hidden md:inline">{{ t('nav.myWork') }}</span>
          </UButton>
        </UTooltip>
        <UColorModeButton class="hidden sm:inline-flex" />
        <NotificationBell v-if="loggedIn && user" />
        <UDropdownMenu v-if="loggedIn && user" :items="menu">
          <UButton color="neutral" variant="ghost" :avatar="{ src: user.avatarUrl ?? undefined, alt: user.name }" :aria-label="user.name">
            <span class="hidden sm:inline truncate max-w-40">{{ user.name }}</span>
          </UButton>
        </UDropdownMenu>
      </template>
    </UHeader>
    <OfflineBanner />
    <main class="flex-1 flex flex-col">
      <slot />
    </main>
    <template v-if="loggedIn">
      <SearchPalette v-model:open="paletteOpen" :is-admin="!!me?.isAdmin" />
      <ShortcutsModal v-model:open="shortcutsOpen" />
    </template>
  </div>
</template>
