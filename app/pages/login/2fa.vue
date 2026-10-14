<script setup lang="ts">
definePageMeta({ layout: false })

const { fetch: refreshSession } = useUserSession()
const showError = useApiError()
const toast = useToast()
const { t } = useI18n()
useHead({ title: () => t('login.twoFactorTitle') })

// Pending sign-ins live in the session cookie for 5 minutes.
const { data: state } = await useFetch<{ pending: boolean }>('/api/auth/two-factor')
const useRecovery = ref(false)
const code = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    const res = await $fetch<{ recoveryCodesLeft?: number }>('/api/auth/two-factor', { method: 'POST', body: { code: code.value } })
    if (res.recoveryCodesLeft !== undefined) {
      toast.add({
        title: t('login.recoveryUsed'),
        description: t('login.recoveryLeft', {}, res.recoveryCodesLeft),
        color: res.recoveryCodesLeft < 3 ? 'warning' : 'info',
      })
    }
    await refreshSession()
    await navigateTo('/')
  }
  catch (err) {
    code.value = ''
    if ((err as { statusCode?: number }).statusCode === 401) state.value = { pending: false }
    showError(err, t('login.failed'))
  }
  finally { loading.value = false }
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-6 p-4">
    <AppLogo large />
    <UPageCard v-if="!state?.pending" class="w-full max-w-md" :title="t('login.expiredTitle')" icon="i-lucide-timer-off">
      <template #description>
        {{ t('login.expired') }}
      </template>
      <UButton to="/login" variant="link" class="px-0" :label="t('auth.backToSignIn')" />
    </UPageCard>
    <UPageCard
      v-else
      class="w-full max-w-md"
      icon="i-lucide-shield-check"
      :title="t('login.twoFactorTitle')"
      :description="useRecovery ? t('login.recoveryHelp') : t('login.codeHelp')"
    >
      <form class="space-y-4" @submit.prevent="submit">
        <UFormField :label="useRecovery ? t('login.recoveryCode') : t('login.code')">
          <UInput
            v-if="useRecovery"
            v-model="code"
            class="w-full"
            autocomplete="off"
            placeholder="xxxxx-xxxxx"
            autofocus
            required
          />
          <UInput
            v-else
            v-model="code"
            class="w-full"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9 ]*"
            maxlength="7"
            placeholder="123456"
            autofocus
            required
          />
        </UFormField>
        <UButton type="submit" block :label="t('login.verify')" :loading="loading" />
      </form>
      <UButton
        variant="link"
        class="px-0"
        :label="useRecovery ? t('login.useApp') : t('login.useRecovery')"
        @click="useRecovery = !useRecovery; code = ''"
      />
    </UPageCard>
  </div>
</template>
