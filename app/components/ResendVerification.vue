<script setup lang="ts">
/** Button that mails a new sign-up confirmation link to `email`. */
const props = defineProps<{ email: string }>()

const toast = useToast()
const { t } = useI18n()
const showError = useApiError()
const loading = ref(false)

async function resend() {
  loading.value = true
  try {
    await $fetch('/api/auth/resend-verification', { method: 'POST', body: { email: props.email } })
    toast.add({ title: t('auth.resent'), description: t('auth.resentDescription', { email: props.email }), color: 'success' })
  }
  catch (err) { showError(err, t('auth.resendFailed')) }
  finally { loading.value = false }
}
</script>

<template>
  <UButton
    :label="t('auth.resend')"
    icon="i-lucide-mail"
    color="neutral"
    variant="subtle"
    block
    :loading="loading"
    @click="resend"
  />
</template>
