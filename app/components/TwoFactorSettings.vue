<script setup lang="ts">
import type { Account } from '#shared/types/account'

const props = defineProps<{ account: Account }>()
const emit = defineEmits<{ changed: [] }>()
const showError = useApiError()
const toast = useToast()
const { t } = useI18n()

// Setup: QR code, then a code from the app to confirm, then the recovery codes.
const setup = ref<{ secret: string, qr: string } | null>(null)
const setupCode = ref('')
const busy = ref(false)
/** Recovery codes just made; shown once. */
const codes = ref<string[] | null>(null)

async function startSetup() {
  busy.value = true
  try {
    setup.value = await $fetch<{ secret: string, qr: string }>('/api/account/two-factor/setup', { method: 'POST' })
    setupCode.value = ''
  }
  catch (err) { showError(err, t('twoFactor.startFailed')) }
  finally { busy.value = false }
}

async function enable() {
  busy.value = true
  try {
    const res = await $fetch<{ recoveryCodes: string[] }>('/api/account/two-factor/enable', { method: 'POST', body: { code: setupCode.value } })
    setup.value = null
    codes.value = res.recoveryCodes
    emit('changed')
    toast.add({ title: t('twoFactor.enabled'), description: t('twoFactor.enabledDescription'), color: 'success' })
  }
  catch (err) { showError(err, t('twoFactor.enableFailed')) }
  finally { busy.value = false }
}

// Regenerate codes or turn off: both open a dialog asking for proof.
const dialog = ref<'codes' | 'disable' | null>(null)
const dialogOpen = computed({ get: () => !!dialog.value, set: (v) => { if (!v) dialog.value = null } })
const proofCode = ref('')
const proofPassword = ref('')

function openDialog(kind: 'codes' | 'disable') {
  proofCode.value = proofPassword.value = ''
  dialog.value = kind
}

async function submitDialog() {
  busy.value = true
  try {
    if (dialog.value === 'codes') {
      const res = await $fetch<{ recoveryCodes: string[] }>('/api/account/two-factor/recovery-codes', { method: 'POST', body: { code: proofCode.value } })
      codes.value = res.recoveryCodes
    }
    else {
      await $fetch('/api/account/two-factor/disable', {
        method: 'POST',
        body: { password: proofPassword.value || undefined, code: proofCode.value || undefined },
      })
      codes.value = null
      toast.add({ title: t('twoFactor.disabled'), color: 'success' })
    }
    dialog.value = null
    emit('changed')
  }
  catch (err) { showError(err, dialog.value === 'codes' ? t('twoFactor.codesFailed') : t('twoFactor.disableFailed')) }
  finally { busy.value = false }
}

async function copyCodes() {
  await navigator.clipboard.writeText(codes.value!.join('\n'))
  toast.add({ title: t('twoFactor.copied'), color: 'success' })
}
</script>

<template>
  <section class="space-y-4">
    <h2 class="text-lg font-medium">
      {{ t('twoFactor.title') }}
    </h2>

    <UAlert
      v-if="codes"
      color="warning"
      variant="subtle"
      icon="i-lucide-key-round"
      :title="t('twoFactor.saveCodes')"
      :description="t('twoFactor.saveCodesDescription')"
    >
      <template #actions>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-copy" :label="t('common.copy')" @click="copyCodes" />
        <UButton size="sm" color="neutral" variant="ghost" :label="t('twoFactor.savedThem')" @click="codes = null" />
      </template>
    </UAlert>
    <ul v-if="codes" class="grid grid-cols-2 gap-1 font-mono text-sm" data-testid="recovery-codes">
      <li v-for="c in codes" :key="c">
        {{ c }}
      </li>
    </ul>

    <template v-if="props.account.twoFactorEnabled">
      <p class="text-sm">
        <UIcon name="i-lucide-shield-check" class="text-success align-middle" />
        {{ t('twoFactor.on') }}
        {{ t('twoFactor.codesLeft', {}, props.account.recoveryCodesLeft) }}
      </p>
      <div class="flex gap-2">
        <UButton color="neutral" variant="outline" :label="t('twoFactor.newCodes')" @click="openDialog('codes')" />
        <UButton color="error" variant="subtle" :label="t('twoFactor.turnOff')" @click="openDialog('disable')" />
      </div>
    </template>

    <template v-else-if="setup">
      <p class="text-sm">
        {{ t('twoFactor.scan') }}
      </p>
      <div class="flex flex-wrap items-center gap-4">
        <img :src="setup.qr" :alt="t('twoFactor.qrAlt')" class="size-44 rounded bg-white">
        <code class="text-sm break-all select-all">{{ setup.secret }}</code>
      </div>
      <form class="flex items-end gap-2" @submit.prevent="enable">
        <UFormField :label="t('twoFactor.appCode')" class="flex-1">
          <UInput v-model="setupCode" class="w-full" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required />
        </UFormField>
        <UButton type="submit" :label="t('twoFactor.turnOn')" :loading="busy" />
        <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="setup = null" />
      </form>
    </template>

    <template v-else>
      <p class="text-sm text-muted">
        {{ props.account.providers.length ? t('twoFactor.offHelpLinked') : t('twoFactor.offHelp') }}
      </p>
      <UButton icon="i-lucide-shield-plus" :label="t('twoFactor.setUp')" :loading="busy" @click="startSetup" />
    </template>

    <UModal v-model:open="dialogOpen" :title="dialog === 'codes' ? t('twoFactor.newCodes') : t('twoFactor.disableTitle')">
      <template #body>
        <form id="two-factor-proof" class="space-y-4" @submit.prevent="submitDialog">
          <p class="text-sm">
            {{ dialog === 'codes'
              ? t('twoFactor.codesHelp')
              : (props.account.hasPassword ? t('twoFactor.disableHelpPassword') : t('twoFactor.disableHelp')) }}
          </p>
          <UFormField v-if="dialog === 'disable' && props.account.hasPassword" :label="t('common.password')">
            <UInput v-model="proofPassword" type="password" class="w-full" autocomplete="current-password" />
          </UFormField>
          <UFormField :label="dialog === 'codes' ? t('twoFactor.appCode') : t('login.code')">
            <UInput v-model="proofCode" class="w-full" autocomplete="one-time-code" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="dialog = null" />
          <UButton
            type="submit"
            form="two-factor-proof"
            :color="dialog === 'disable' ? 'error' : 'primary'"
            :label="dialog === 'codes' ? t('twoFactor.makeCodes') : t('twoFactor.turnOff')"
            :loading="busy"
            :disabled="!proofCode.trim() && !proofPassword"
          />
        </div>
      </template>
    </UModal>
  </section>
</template>
