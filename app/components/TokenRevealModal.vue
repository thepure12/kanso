<script setup lang="ts">
// Shows an existing API token again: asks for a code from the caller's
// authenticator app, then shows the token like a new one (TokenCreatedPanel).
// Used by ApiTokenList (personal), BotsSlideover and AccountBots (bots).
const props = defineProps<{
  /** The token's name, for the title. */
  name: string
  /** The reveal route, e.g. /api/account/tokens/:id/reveal. */
  url: string
  /** Who the token acts as, passed to TokenCreatedPanel. */
  warning?: string
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ revealed: [] }>()
const { t } = useI18n()
const showError = useApiError()

const code = ref('')
const loading = ref(false)
const token = ref<string | null>(null)
/** Set when the server says the code is wrong or two-factor is off. */
const problem = ref<'badCode' | 'twoFactorRequired' | null>(null)

// Each opening starts over and never keeps a token around.
watch(open, () => {
  code.value = ''
  token.value = null
  problem.value = null
})

async function reveal() {
  if (!code.value.trim()) return
  loading.value = true
  problem.value = null
  try {
    token.value = (await $fetch<{ token: string }>(props.url, { method: 'POST', body: { code: code.value.trim() } })).token
    emit('revealed')
  }
  catch (err) {
    const p = (err as { data?: { data?: { problem?: string } } }).data?.data?.problem
    if (p === 'badCode' || p === 'twoFactorRequired') problem.value = p
    else showError(err, t('tokens.reveal.failed'))
    code.value = ''
  }
  finally { loading.value = false }
}
</script>

<template>
  <UModal v-model:open="open" :title="t('tokens.reveal.title', { name: props.name })">
    <template #body>
      <TokenCreatedPanel v-if="token" :token="token" :warning="props.warning" />
      <UAlert
        v-else-if="problem === 'twoFactorRequired'"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        :title="t('tokens.reveal.twoFactorRequired')"
        :description="t('tokens.reveal.twoFactorRequiredDescription')"
        :actions="[{ label: t('tokens.reveal.setUpTwoFactor'), to: '/account?tab=security', color: 'neutral', variant: 'outline' }]"
      />
      <form v-else id="reveal-token" class="space-y-3" @submit.prevent="reveal">
        <p class="text-sm text-muted">
          {{ t('tokens.reveal.help') }}
        </p>
        <UFormField :label="t('tokens.reveal.code')" :error="problem === 'badCode' ? t('tokens.reveal.badCode') : undefined">
          <UInput
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="32"
            class="w-40 font-mono"
            data-testid="reveal-code"
            required
            autofocus
          />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton v-if="token || problem === 'twoFactorRequired'" :label="t('common.done')" @click="open = false" />
        <template v-else>
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="open = false" />
          <UButton type="submit" form="reveal-token" :label="t('tokens.reveal.show')" :loading="loading" :disabled="!code.trim()" />
        </template>
      </div>
    </template>
  </UModal>
</template>
