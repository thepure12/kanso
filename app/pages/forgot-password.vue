<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: false })

const showError = useApiError()
const { t } = useI18n()
useHead({ title: () => t('forgot.title') })
const loading = ref(false)

const fields = computed(() => [
  { name: 'email', type: 'email' as const, label: t('common.email'), placeholder: t('auth.emailPlaceholder'), required: true },
])
const schema = computed(() => z.object({ email: z.email(t('auth.invalidEmail')) }))
type Schema = z.output<typeof schema.value>

/** Set once the request went through; the server does not say whether the account exists. */
const sentTo = ref('')

async function onSubmit(e: FormSubmitEvent<Schema>) {
  loading.value = true
  try {
    await $fetch('/api/auth/forgot-password', { method: 'POST', body: e.data })
    sentTo.value = e.data.email
  }
  catch (err) { showError(err, t('forgot.failed')) }
  finally { loading.value = false }
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-6 p-4">
    <AppLogo large />
    <UPageCard v-if="sentTo" class="w-full max-w-md" :title="t('auth.checkInbox')" icon="i-lucide-mail-check">
      <template #description>
        <i18n-t keypath="forgot.sent" scope="global">
          <template #email>
            <strong>{{ sentTo }}</strong>
          </template>
        </i18n-t>
      </template>
      <UButton to="/login" variant="link" class="px-0" :label="t('auth.backToSignIn')" />
    </UPageCard>
    <UPageCard v-else class="w-full max-w-md">
      <UAuthForm
        :schema="schema"
        :fields="fields"
        :loading="loading"
        :title="t('forgot.title')"
        :submit="{ label: t('forgot.submit') }"
        @submit="onSubmit"
      >
        <template #description>
          {{ t('forgot.help') }}
          <ULink to="/login" class="text-primary font-medium">{{ t('auth.backToSignIn') }}</ULink>
        </template>
      </UAuthForm>
    </UPageCard>
  </div>
</template>
