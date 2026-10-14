<script setup lang="ts">
import { de, en } from '@nuxt/ui/locale'

useHead({ titleTemplate: title => title ? `${title} · Kanso` : 'Kanso' })

// Nuxt UI's own strings (close buttons, calendar, ...) and <html lang dir> follow the i18n locale.
const { t, locale } = useI18n()
const uiLocale = computed(() => ({ en, de })[locale.value as 'en' | 'de'] ?? en)
useHead({ htmlAttrs: { lang: () => uiLocale.value.code, dir: () => uiLocale.value.dir } })

// A new service worker waits (registerType 'prompt'); reloading activates it.
// $pwa is only set in the browser, and the worker only exists in production builds.
const { $pwa } = useNuxtApp()
const toast = useToast()
onMounted(() => {
  if (!$pwa) return
  watch(() => $pwa.needRefresh, (needRefresh) => {
    if (!needRefresh) return
    toast.add({
      title: t('pwa.updateTitle'),
      description: t('pwa.updateDescription'),
      icon: 'i-lucide-refresh-cw',
      duration: 0,
      actions: [{ label: t('pwa.reload'), icon: 'i-lucide-rotate-cw', color: 'primary', variant: 'solid', onClick: () => { $pwa.updateServiceWorker(true) } }],
    })
  }, { immediate: true })
})
</script>

<template>
  <UApp :locale="uiLocale">
    <NuxtPwaManifest />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
