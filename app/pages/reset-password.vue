<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: false })

const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const showError = useApiError()
const { t } = useI18n()
useHead({ title: () => t('reset.title') })
const loading = ref(false)
const token = computed(() => typeof route.query.token === 'string' ? route.query.token : '')

const fields = computed(() => [
  { name: 'password', type: 'password' as const, label: t('account.password.new'), description: t('auth.minLength'), required: true },
  { name: 'confirmPassword', type: 'password' as const, label: t('auth.confirmPassword'), required: true },
])
const schema = computed(() => z.object({
  password: z.string().min(8, t('auth.minLength')),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: t('auth.mismatch'), path: ['confirmPassword'] }))
type Schema = z.output<typeof schema.value>
const formRoot = useTemplateRef<HTMLElement>('formRoot')
useSkipPasswordToggleTab(formRoot)

async function onSubmit(e: FormSubmitEvent<Schema>) {
  loading.value = true
  try {
    const res = await $fetch<{ twoFactor?: boolean }>('/api/auth/reset-password', { method: 'POST', body: { token: token.value, password: e.data.password } })
    // The password changed, but two-factor still has to be passed.
    if (res.twoFactor) return await navigateTo('/login/2fa')
    await refreshSession()
    await navigateTo('/')
  }
  catch (err) { showError(err, t('reset.failed')) }
  finally { loading.value = false }
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-6 p-4">
    <AppLogo large />
    <UPageCard v-if="!token" class="w-full max-w-md" :title="t('reset.invalidTitle')" icon="i-lucide-link-2-off">
      <template #description>
        {{ t('reset.invalid') }}
      </template>
      <UButton to="/forgot-password" variant="link" class="px-0" :label="t('reset.askNew')" />
    </UPageCard>
    <UPageCard v-else class="w-full max-w-md">
      <div ref="formRoot">
        <UAuthForm
          :schema="schema"
          :fields="fields"
          :loading="loading"
          :title="t('reset.title')"
          :submit="{ label: t('reset.submit') }"
          @submit="onSubmit"
        >
          <template #description>
            {{ t('reset.signsOut') }}
          </template>
        </UAuthForm>
      </div>
    </UPageCard>
  </div>
</template>
