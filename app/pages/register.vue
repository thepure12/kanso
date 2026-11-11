<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: false })

const { t } = useI18n()
useHead({ title: () => t('register.title') })
const providers = await useProviders()
const showError = useApiError()
const loading = ref(false)
const { data: signup } = await useFetch('/api/auth/signup')
const restricted = computed(() => signup.value?.mode === 'restricted')
// Invite mails link here with ?email= (filled in) and ?invite= (a token that
// proves the address: signing up with that email skips the confirmation mail).
const route = useRoute()
const queryString = (v: unknown) => typeof v === 'string' ? v : undefined
const invitedEmail = queryString(route.query.email)
const inviteToken = queryString(route.query.invite)
const { fetch: refreshSession } = useUserSession()

const fields = computed(() => [
  { name: 'name', type: 'text' as const, label: t('common.name'), required: true },
  { name: 'email', type: 'email' as const, label: t('common.email'), placeholder: t('auth.emailPlaceholder'), required: true, defaultValue: invitedEmail },
  { name: 'password', type: 'password' as const, label: t('common.password'), description: t('auth.minLength'), required: true },
  { name: 'confirmPassword', type: 'password' as const, label: t('auth.confirmPassword'), required: true },
])
const schema = computed(() => z.object({
  name: z.string().trim().min(1, t('auth.required')),
  email: z.email(t('auth.invalidEmail')),
  password: z.string().min(8, t('auth.minLength')),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: t('auth.mismatch'), path: ['confirmPassword'] }))
type Schema = z.output<typeof schema.value>

/** Set once the confirmation email is sent; the account works only after its link is opened. */
const sentTo = ref('')
const formRoot = useTemplateRef<HTMLElement>('formRoot')
useSkipPasswordToggleTab(formRoot)

async function onSubmit(e: FormSubmitEvent<Schema>) {
  loading.value = true
  try {
    const { confirmPassword: _, ...body } = e.data
    const res = await $fetch<{ signedIn?: true, twoFactor?: boolean }>('/api/auth/register', { method: 'POST', body: { ...body, invite: inviteToken } })
    if (res.signedIn) {
      if (res.twoFactor) return await navigateTo('/login/2fa')
      await refreshSession()
      return await navigateTo('/')
    }
    sentTo.value = body.email
  }
  catch (err) { showError(err, t('register.failed')) }
  finally { loading.value = false }
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-6 p-4">
    <AppLogo large />
    <UPageCard v-if="sentTo" class="w-full max-w-md" :title="t('auth.checkInbox')" icon="i-lucide-mail-check">
      <template #description>
        <i18n-t keypath="register.sent" scope="global">
          <template #email>
            <strong>{{ sentTo }}</strong>
          </template>
        </i18n-t>
      </template>
      <ResendVerification :email="sentTo" />
    </UPageCard>
    <UPageCard v-else class="w-full max-w-md">
      <div ref="formRoot">
        <UAuthForm
          :schema="schema"
          :fields="fields"
          :providers="providers"
          :loading="loading"
          :title="t('register.title')"
          :submit="{ label: t('register.title') }"
          @submit="onSubmit"
        >
          <template #description>
            {{ t('register.already') }} <ULink to="/login" class="text-primary font-medium">{{ t('register.signIn') }}</ULink>
            <p v-if="restricted" class="mt-2">
              {{ t('register.restricted') }}
            </p>
          </template>
        </UAuthForm>
      </div>
    </UPageCard>
  </div>
</template>
