<script setup lang="ts">
import type { Locale } from '#shared/i18n'
import type { Account } from '#shared/types/account'

const route = useRoute()
const router = useRouter()
const { fetch: refreshSession, clear } = useUserSession()
const showError = useApiError()
const toast = useToast()
const { t } = useI18n()
useHead({ title: () => t('account.title') })

const { data: account, refresh } = await useFetch<Account>('/api/account')

onMounted(() => {
  if (route.query.error) showError({ statusMessage: String(route.query.error) }, t('account.email.notChanged'))
  else if (route.query.emailChanged) toast.add({ title: t('account.email.changed'), description: t('account.email.changedDescription', { email: account.value?.email }), color: 'success' })
  if (route.query.error || route.query.emailChanged) router.replace({ query: {} })
})

// Profile
const name = ref(account.value?.name ?? '')
const savingName = ref(false)
async function saveName() {
  savingName.value = true
  try {
    await $fetch('/api/account', { method: 'PATCH', body: { name: name.value } })
    await Promise.all([refresh(), refreshSession()])
    toast.add({ title: t('account.profile.saved'), color: 'success' })
  }
  catch (err) { showError(err, t('account.profile.saveFailed')) }
  finally { savingName.value = false }
}

// Password
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)
const passwordMismatch = computed(() => !!confirmPassword.value && newPassword.value !== confirmPassword.value)
async function savePassword() {
  if (newPassword.value.length < 8 || passwordMismatch.value) return
  savingPassword.value = true
  try {
    await $fetch('/api/account/password', {
      method: 'POST',
      body: { currentPassword: currentPassword.value || undefined, newPassword: newPassword.value },
    })
    currentPassword.value = newPassword.value = confirmPassword.value = ''
    await Promise.all([refresh(), sessionList.value?.refresh()])
    toast.add({ title: t('account.password.saved'), description: t('account.password.savedDescription'), color: 'success' })
  }
  catch (err) { showError(err, t('account.password.saveFailed')) }
  finally { savingPassword.value = false }
}

// Email
const newEmail = ref('')
const emailPassword = ref('')
const emailSentTo = ref('')
const savingEmail = ref(false)
async function changeEmail() {
  savingEmail.value = true
  try {
    const res = await $fetch<{ sentTo: string }>('/api/account/email', {
      method: 'POST',
      body: { email: newEmail.value, password: emailPassword.value || undefined },
    })
    emailSentTo.value = res.sentTo
    newEmail.value = emailPassword.value = ''
  }
  catch (err) { showError(err, t('account.email.saveFailed')) }
  finally { savingEmail.value = false }
}

// Two-factor: turning it on renews this session and signs out the others.
const sessionList = useTemplateRef<{ refresh: () => Promise<void> }>('sessionList')
async function onTwoFactorChanged() {
  await Promise.all([refresh(), sessionList.value?.refresh()])
}

// Notifications
async function setDigest(enabled: boolean) {
  try {
    await $fetch('/api/account', { method: 'PATCH', body: { digestEnabled: enabled } })
    await refresh()
  }
  catch (err) { showError(err, t('account.settingFailed')) }
}

// Language: saved on the account (also used for emails and webhook messages)
// and applied now; 'auto' clears it and goes back to the browser's language.
const { setLocale } = useI18n()
const languageItems = computed(() => [
  { label: t('language.auto'), value: 'auto' },
  { label: t('language.en'), value: 'en' },
  { label: t('language.de'), value: 'de' },
])
async function setLanguage(value: string) {
  const locale = value === 'auto' ? null : value as Locale
  try {
    await $fetch('/api/account', { method: 'PATCH', body: { locale } })
    await setLocale(locale ?? (useBrowserLocale() as Locale | null) ?? 'en')
    await Promise.all([refresh(), refreshNuxtData('me')])
  }
  catch (err) { showError(err, t('account.settingFailed')) }
}

// Danger zone
const deleteOpen = ref(false)
const deleteConfirm = ref('')
const deleting = ref(false)
async function deleteAccount() {
  deleting.value = true
  try {
    await $fetch('/api/account', { method: 'DELETE', body: { confirm: deleteConfirm.value } })
    await clear()
    await navigateTo('/login')
  }
  catch (err) { showError(err, t('account.delete.failed')) }
  finally { deleting.value = false }
}

const providerLabel: Record<string, string> = { discord: 'Discord', github: 'GitHub', google: 'Google' }
</script>

<template>
  <UContainer class="py-8 space-y-10 max-w-2xl">
    <h1 class="text-2xl font-semibold">
      {{ t('account.title') }}
    </h1>

    <template v-if="account">
      <section class="space-y-4">
        <h2 class="text-lg font-medium">
          {{ t('account.profile.title') }}
        </h2>
        <form class="flex items-end gap-2" @submit.prevent="saveName">
          <UFormField :label="t('common.name')" class="flex-1">
            <UInput v-model="name" class="w-full" maxlength="100" required />
          </UFormField>
          <UButton type="submit" :label="t('common.save')" :loading="savingName" :disabled="!name.trim() || name.trim() === account.name" />
        </form>
        <p v-if="account.providers.length" class="text-sm text-muted">
          {{ t('account.profile.linked', { providers: account.providers.map(p => providerLabel[p] ?? p).join(', ') }) }}
        </p>
      </section>

      <section class="space-y-4">
        <h2 class="text-lg font-medium">
          {{ t('common.email') }}
        </h2>
        <i18n-t keypath="account.email.current" tag="p" class="text-sm" scope="global">
          <template #email>
            <strong>{{ account.email }}</strong>
          </template>
        </i18n-t>
        <UAlert
          v-if="emailSentTo"
          color="info"
          variant="subtle"
          icon="i-lucide-mail-check"
          :title="t('account.email.checkInbox')"
          :description="t('account.email.sent', { email: emailSentTo })"
        />
        <form class="space-y-4" @submit.prevent="changeEmail">
          <UFormField :label="t('account.email.new')">
            <UInput v-model="newEmail" type="email" class="w-full" autocomplete="email" required />
          </UFormField>
          <UFormField v-if="account.hasPassword" :label="t('account.password.current')">
            <UInput v-model="emailPassword" type="password" class="w-full" autocomplete="current-password" required />
          </UFormField>
          <UButton type="submit" :label="t('account.email.send')" :loading="savingEmail" />
        </form>
      </section>

      <section class="space-y-4">
        <h2 class="text-lg font-medium">
          {{ t('common.password') }}
        </h2>
        <p v-if="!account.hasPassword" class="text-sm text-muted">
          {{ t('account.password.oauthOnly', { providers: account.providers.map(p => providerLabel[p] ?? p).join(', ') || t('account.password.linkedAccount') }) }}
        </p>
        <form class="space-y-4" @submit.prevent="savePassword">
          <UFormField v-if="account.hasPassword" :label="t('account.password.current')">
            <UInput v-model="currentPassword" type="password" class="w-full" autocomplete="current-password" required />
          </UFormField>
          <UFormField :label="t('account.password.new')" :description="t('account.password.minLength')">
            <UInput v-model="newPassword" type="password" class="w-full" autocomplete="new-password" minlength="8" required />
          </UFormField>
          <UFormField :label="t('account.password.confirm')" :error="passwordMismatch ? t('account.password.mismatch') : undefined">
            <UInput v-model="confirmPassword" type="password" class="w-full" autocomplete="new-password" required />
          </UFormField>
          <UButton type="submit" :label="account.hasPassword ? t('account.password.change') : t('account.password.set')" :loading="savingPassword" />
        </form>
        <p class="text-sm text-muted">
          {{ t('account.password.signsOut') }}
        </p>
      </section>

      <TwoFactorSettings :account="account" @changed="onTwoFactorChanged" />

      <SessionList ref="sessionList" />

      <ApiTokenList />

      <section class="space-y-4">
        <h2 class="text-lg font-medium">
          {{ t('language.label') }}
        </h2>
        <UFormField :label="t('language.label')" :description="t('language.help')">
          <USelect :model-value="account.locale ?? 'auto'" :items="languageItems" class="w-56" @update:model-value="setLanguage" />
        </UFormField>
      </section>

      <section class="space-y-4">
        <h2 class="text-lg font-medium">
          {{ t('account.notifications.title') }}
        </h2>
        <USwitch
          :model-value="account.digestEnabled"
          :label="t('account.notifications.digest')"
          :description="t('account.notifications.digestDescription')"
          @update:model-value="setDigest"
        />
      </section>

      <section class="space-y-4">
        <h2 class="text-lg font-medium text-error">
          {{ t('account.delete.title') }}
        </h2>
        <p class="text-sm text-muted">
          {{ t('account.delete.explain') }}
        </p>
        <UButton color="error" variant="subtle" icon="i-lucide-trash-2" :label="t('account.delete.title')" @click="deleteOpen = true" />
      </section>
    </template>

    <UModal v-model:open="deleteOpen" :title="t('account.delete.confirmTitle')">
      <template #body>
        <form id="delete-account" class="space-y-4" @submit.prevent="deleteAccount">
          <i18n-t keypath="account.delete.confirmText" tag="p" class="text-sm" scope="global">
            <template #email>
              <strong>{{ account?.email }}</strong>
            </template>
          </i18n-t>
          <UInput v-model="deleteConfirm" class="w-full" autocomplete="off" />
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="deleteOpen = false" />
          <UButton
            type="submit"
            form="delete-account"
            color="error"
            :label="t('account.delete.title')"
            :loading="deleting"
            :disabled="deleteConfirm.trim().toLowerCase() !== account?.email.toLowerCase()"
          />
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
