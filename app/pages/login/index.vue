<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: false })

const route = useRoute()
const { t } = useI18n()
useHead({ title: () => t('login.title') })
const { fetch: refreshSession } = useUserSession()
const providers = await useProviders()
const showError = useApiError()
const loading = ref(false)

const fields = computed(() => [
  { name: 'email', type: 'email' as const, label: t('common.email'), placeholder: t('auth.emailPlaceholder'), required: true },
  { name: 'password', type: 'password' as const, label: t('common.password'), required: true },
])
const schema = computed(() => z.object({ email: z.email(t('auth.invalidEmail')), password: z.string().min(1, t('auth.required')) }))
type Schema = z.output<typeof schema.value>
/** Email of an account that signed in correctly but has not confirmed its email yet. */
const unverified = ref('')
const formRoot = useTemplateRef<HTMLElement>('formRoot')
useSkipPasswordToggleTab(formRoot)

onMounted(() => {
  if (route.query.error) showError({ statusMessage: String(route.query.error) }, t('login.failed'))
})

async function onSubmit(e: FormSubmitEvent<Schema>) {
  loading.value = true
  unverified.value = ''
  try {
    const res = await $fetch<{ twoFactor?: boolean }>('/api/auth/login', { method: 'POST', body: e.data })
    if (res.twoFactor) return await navigateTo('/login/2fa')
    await refreshSession()
    await navigateTo('/')
  }
  catch (err) {
    if ((err as { statusCode?: number }).statusCode === 403) unverified.value = e.data.email
    showError(err, t('login.failed'))
  }
  finally { loading.value = false }
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-6 p-4">
    <AppLogo large />
    <UPageCard class="w-full max-w-md">
      <div ref="formRoot">
        <UAuthForm
          :schema="schema"
          :fields="fields"
          :providers="providers"
          :loading="loading"
          :title="t('login.title')"
          :submit="{ label: t('login.title') }"
          @submit="onSubmit"
        >
          <template #description>
            {{ t('login.noAccount') }} <ULink to="/register" class="text-primary font-medium">{{ t('login.createOne') }}</ULink>
            <p class="mt-1">
              <ULink to="/forgot-password" class="text-primary font-medium">{{ t('login.forgot') }}</ULink>
            </p>
          </template>
        </UAuthForm>
      </div>
      <ResendVerification v-if="unverified" :email="unverified" class="mt-4" />
    </UPageCard>
  </div>
</template>
