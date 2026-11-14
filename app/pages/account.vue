<script setup lang="ts">
import { AvatarCropModal } from '#components'
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

// Tab, kept in ?tab= (profile is the default and leaves the query out).
const tab = computed<AccountTab>({
  get: () => accountTabFrom(route.query.tab),
  set: v => router.replace({ query: { ...route.query, tab: v === 'profile' ? undefined : v } }),
})
const tabs = computed(() => [
  { label: t('account.profile.title'), value: 'profile', icon: 'i-lucide-user' },
  { label: t('account.security'), value: 'security', icon: 'i-lucide-shield' },
  { label: t('account.notifications.title'), value: 'notifications', icon: 'i-lucide-bell' },
  { label: t('tokens.title'), value: 'tokens', icon: 'i-lucide-key-round' },
])

onMounted(() => {
  if (route.query.error) showError({ statusMessage: String(route.query.error) }, t('account.email.notChanged'))
  else if (route.query.emailChanged) toast.add({ title: t('account.email.changed'), description: t('account.email.changedDescription', { email: account.value?.email }), color: 'success' })
  if (route.query.error || route.query.emailChanged) router.replace({ query: { tab: route.query.tab } })
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

// Profile picture: cropped by the user and scaled down in the browser, then uploaded.
const overlay = useOverlay()
const pictureInput = useTemplateRef<HTMLInputElement>('pictureInput')
const savingPicture = ref(false)
async function onPicture(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!AVATAR_TYPES.includes(file.type)) {
    toast.add({ title: t('account.profile.pictureWrongType'), color: 'error' })
    return
  }
  const cropped = await overlay.create(AvatarCropModal, { destroyOnClose: true }).open({ file }).result
  if (!cropped) return
  savingPicture.value = true
  try {
    const form = new FormData()
    form.append('file', cropped, 'avatar')
    await $fetch('/api/account/avatar', { method: 'POST', body: form })
    await Promise.all([refresh(), refreshSession()])
    toast.add({ title: t('account.profile.pictureSaved'), color: 'success' })
  }
  catch (err) { showError(err, t('account.profile.pictureFailed')) }
  finally { savingPicture.value = false }
}
async function removePicture() {
  savingPicture.value = true
  try {
    await $fetch('/api/account/avatar', { method: 'DELETE' })
    await Promise.all([refresh(), refreshSession()])
    toast.add({ title: t('account.profile.pictureRemoved'), color: 'success' })
  }
  catch (err) { showError(err, t('account.profile.pictureRemoveFailed')) }
  finally { savingPicture.value = false }
}

// Password
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)
// The forms stay folded behind a button; without a password the set form shows at once.
const passwordFormOpen = ref(false)
const showPasswordForm = computed(() => passwordFormOpen.value || !account.value?.hasPassword)
function closePasswordForm() {
  passwordFormOpen.value = false
  currentPassword.value = newPassword.value = confirmPassword.value = ''
}
const passwordMismatch = computed(() => !!confirmPassword.value && newPassword.value !== confirmPassword.value)
async function savePassword() {
  if (newPassword.value.length < 8 || passwordMismatch.value) return
  savingPassword.value = true
  try {
    await $fetch('/api/account/password', {
      method: 'POST',
      body: { currentPassword: currentPassword.value || undefined, newPassword: newPassword.value },
    })
    closePasswordForm()
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
const emailFormOpen = ref(false)
function closeEmailForm() {
  emailFormOpen.value = false
  newEmail.value = emailPassword.value = ''
}
async function changeEmail() {
  savingEmail.value = true
  try {
    const res = await $fetch<{ sentTo: string }>('/api/account/email', {
      method: 'POST',
      body: { email: newEmail.value, password: emailPassword.value || undefined },
    })
    emailSentTo.value = res.sentTo
    closeEmailForm()
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

// Desktop notifications: per device, no server state.
const desktop = useDesktopNotifications()
onMounted(desktop.sync)
const desktopHint = computed(() => {
  if (desktop.permission.value === 'unsupported') return t('account.notifications.desktopUnsupported')
  if (desktop.permission.value === 'denied') return t('account.notifications.desktopBlocked')
  return t('account.notifications.desktopDescription')
})
// No tag: a repeated tag replaces the earlier notification without showing it again.
function testDesktop() {
  desktop.sync()
  if (!desktop.enabled.value) {
    toast.add({ title: desktopHint.value, color: 'warning' })
    return
  }
  try {
    const shown = new Notification(t('account.notifications.desktopTestTitle'), {
      body: t('account.notifications.desktopTestBody'),
      icon: appUrl('/pwa-192x192.png'),
    })
    shown.onshow = () => toast.add({ title: t('account.notifications.desktopTestSent'), description: t('account.notifications.desktopTestHint') })
    shown.onerror = () => toast.add({ title: t('account.notifications.desktopTestFailed'), description: t('account.notifications.desktopTestHint'), color: 'warning' })
  }
  catch (err) {
    toast.add({ title: t('account.notifications.desktopTestFailed'), description: err instanceof Error ? err.message : String(err), color: 'warning' })
  }
}
async function setDesktop(on: boolean) {
  if (!await desktop.setEnabled(on)) toast.add({ title: t('account.notifications.desktopBlocked'), color: 'warning' })
}

// Push notifications: this browser's subscription, also when Kanso is closed.
const push = usePushNotifications()
const pushBusy = ref(false)
onMounted(() => push.sync().catch(() => {}))
const pushHint = computed(() => {
  if (push.state.value === 'unsupported') return t('account.notifications.pushUnsupported')
  if (push.state.value === 'denied') return t('account.notifications.desktopBlocked')
  return t('account.notifications.pushDescription')
})
async function setPush(on: boolean) {
  pushBusy.value = true
  try {
    if (!await push.setEnabled(on)) toast.add({ title: push.state.value === 'denied' ? t('account.notifications.desktopBlocked') : t('account.notifications.pushFailed'), color: 'warning' })
  }
  catch (err) { showError(err, t('account.notifications.pushFailed')) }
  finally { pushBusy.value = false }
}
async function testPush() {
  try {
    const { sent } = await push.test()
    if (sent) toast.add({ title: t('account.notifications.pushTestSent'), description: t('account.notifications.desktopTestHint') })
    else toast.add({ title: t('account.notifications.pushTestFailed'), color: 'warning' })
  }
  catch (err) { showError(err, t('account.notifications.pushTestFailed')) }
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
  <UContainer class="py-8 space-y-6 max-w-2xl">
    <h1 class="text-2xl font-semibold">
      {{ t('account.title') }}
    </h1>

    <template v-if="account">
      <UTabs v-model="tab" :items="tabs" :content="false" variant="link" class="w-full" :ui="{ trigger: 'flex-none', leadingIcon: 'hidden sm:inline-flex' }" />

      <!-- v-show, not tab content: keeps half-filled forms and loaded lists when switching tabs. -->
      <div v-show="tab === 'profile'" class="divide-y divide-default *:py-6 *:first:pt-0">
        <section class="space-y-4">
          <h2 class="text-lg font-medium">
            {{ t('account.profile.title') }}
          </h2>
          <div class="flex items-center gap-4">
            <UAvatar :src="account.avatarUrl ?? undefined" :alt="account.name" size="3xl" />
            <div class="space-y-2 min-w-0">
              <div class="flex flex-wrap gap-2">
                <UButton
                  color="neutral" variant="outline" size="sm" icon="i-lucide-image-up"
                  :label="account.avatarUrl ? t('account.profile.pictureChange') : t('account.profile.pictureUpload')"
                  :loading="savingPicture"
                  @click="pictureInput?.click()"
                />
                <UButton
                  v-if="account.avatarUrl"
                  color="neutral" variant="ghost" size="sm" icon="i-lucide-trash-2"
                  :label="t('account.profile.pictureRemove')"
                  :disabled="savingPicture"
                  @click="removePicture"
                />
              </div>
              <p class="text-xs text-muted">
                {{ t('account.profile.pictureHint') }}
              </p>
            </div>
            <input ref="pictureInput" type="file" :accept="AVATAR_TYPES.join(',')" class="hidden" :aria-label="t('account.profile.picture')" @change="onPicture">
          </div>
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
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-lg font-medium">
              {{ t('common.email') }}
            </h2>
            <UButton
              v-if="!emailFormOpen"
              color="neutral" variant="outline" size="sm" icon="i-lucide-pencil"
              :label="t('account.email.change')"
              @click="emailFormOpen = true"
            />
          </div>
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
          <form v-if="emailFormOpen" class="space-y-4" @submit.prevent="changeEmail">
            <UFormField :label="t('account.email.new')">
              <UInput v-model="newEmail" type="email" class="w-full" autocomplete="email" autofocus required />
            </UFormField>
            <UFormField v-if="account.hasPassword" :label="t('account.password.current')">
              <UInput v-model="emailPassword" type="password" class="w-full" autocomplete="current-password" required />
            </UFormField>
            <div class="flex gap-2">
              <UButton type="submit" :label="t('account.email.send')" :loading="savingEmail" />
              <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="closeEmailForm" />
            </div>
          </form>
        </section>

        <section class="space-y-4">
          <h2 class="text-lg font-medium">
            {{ t('language.label') }}
          </h2>
          <UFormField :description="t('language.help')">
            <USelect :model-value="account.locale ?? 'auto'" :items="languageItems" class="w-56" :aria-label="t('language.label')" @update:model-value="setLanguage" />
          </UFormField>
        </section>

        <section class="space-y-4">
          <div class="rounded-lg border border-error/40 p-4 space-y-3">
            <h2 class="text-lg font-medium text-error">
              {{ t('account.dangerZone') }}
            </h2>
            <p class="text-sm text-muted">
              {{ t('account.delete.explain') }}
            </p>
            <UButton color="error" variant="subtle" icon="i-lucide-trash-2" :label="t('account.delete.title')" @click="deleteOpen = true" />
          </div>
        </section>
      </div>

      <div v-show="tab === 'security'" class="divide-y divide-default *:py-6 *:first:pt-0">
        <section class="space-y-4">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-lg font-medium">
              {{ t('common.password') }}
            </h2>
            <UButton
              v-if="!showPasswordForm"
              color="neutral" variant="outline" size="sm" icon="i-lucide-key-round"
              :label="t('account.password.change')"
              @click="passwordFormOpen = true"
            />
          </div>
          <p v-if="!account.hasPassword" class="text-sm text-muted">
            {{ t('account.password.oauthOnly', { providers: account.providers.map(p => providerLabel[p] ?? p).join(', ') || t('account.password.linkedAccount') }) }}
          </p>
          <p v-else class="text-sm text-muted">
            {{ t('account.password.signsOut') }}
          </p>
          <form v-if="showPasswordForm" class="space-y-4" @submit.prevent="savePassword">
            <UFormField v-if="account.hasPassword" :label="t('account.password.current')">
              <UInput v-model="currentPassword" type="password" class="w-full" autocomplete="current-password" autofocus required />
            </UFormField>
            <UFormField :label="t('account.password.new')" :description="t('account.password.minLength')">
              <UInput v-model="newPassword" type="password" class="w-full" autocomplete="new-password" minlength="8" required />
            </UFormField>
            <UFormField :label="t('account.password.confirm')" :error="passwordMismatch ? t('account.password.mismatch') : undefined">
              <UInput v-model="confirmPassword" type="password" class="w-full" autocomplete="new-password" required />
            </UFormField>
            <div class="flex gap-2">
              <UButton type="submit" :label="account.hasPassword ? t('account.password.change') : t('account.password.set')" :loading="savingPassword" />
              <UButton v-if="account.hasPassword" color="neutral" variant="ghost" :label="t('common.cancel')" @click="closePasswordForm" />
            </div>
          </form>
        </section>

        <TwoFactorSettings :account="account" @changed="onTwoFactorChanged" />

        <SessionList ref="sessionList" />
      </div>

      <div v-show="tab === 'notifications'" class="space-y-8">
        <NotificationEventSettings
          :prefs="account.notificationPrefs"
          :notify-watching="account.notifyWatching"
          :digest-enabled="account.digestEnabled"
          @changed="refresh()"
        />

        <section class="space-y-4">
          <h2 class="text-lg font-medium">
            {{ t('common.email') }}
          </h2>
          <USwitch
            :model-value="account.digestEnabled"
            :label="t('account.notifications.digest')"
            :description="t('account.notifications.digestDescription')"
            @update:model-value="setDigest"
          />
        </section>

        <section class="space-y-4">
          <h2 class="text-lg font-medium">
            {{ t('account.notifications.thisDevice') }}
          </h2>
          <div class="flex items-start gap-4">
            <USwitch
              :model-value="push.state.value === 'on'"
              :disabled="pushBusy || push.state.value === 'unsupported' || push.state.value === 'denied'"
              :loading="pushBusy"
              :label="t('account.notifications.push')"
              :description="pushHint"
              class="flex-1"
              @update:model-value="setPush"
            />
            <UButton
              size="sm" color="neutral" variant="outline" icon="i-lucide-bell-ring"
              :label="t('account.notifications.desktopTest')" :disabled="push.state.value !== 'on'"
              @click="testPush"
            />
          </div>
          <USwitch
            :model-value="desktop.toasts.value"
            :label="t('account.notifications.toasts')"
            :description="t('account.notifications.toastsDescription')"
            @update:model-value="desktop.setToasts"
          />
          <div class="flex items-start gap-4">
            <USwitch
              :model-value="desktop.enabled.value"
              :disabled="desktop.permission.value === 'unsupported' || desktop.permission.value === 'denied'"
              :label="t('account.notifications.desktop')"
              :description="desktopHint"
              class="flex-1"
              @update:model-value="setDesktop"
            />
            <UButton
              size="sm" color="neutral" variant="outline" icon="i-lucide-bell-ring"
              :label="t('account.notifications.desktopTest')" :disabled="!desktop.enabled.value"
              @click="testDesktop"
            />
          </div>
          <USwitch
            :model-value="desktop.whenFocused.value"
            :disabled="!desktop.enabled.value"
            :label="t('account.notifications.desktopFocused')"
            :description="t('account.notifications.desktopFocusedDescription')"
            @update:model-value="desktop.setWhenFocused"
          />
        </section>
      </div>

      <ApiTokenList v-show="tab === 'tokens'" />
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
