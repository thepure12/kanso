<script setup lang="ts">
import type { AdminUser, InstanceSettings } from '#shared/types/admin'
import { parseList } from '#shared/signup'

const { user } = useUserSession()
const showError = useApiError()
const toast = useToast()
const { t } = useI18n()
const auditLog = useTemplateRef<{ refresh: () => Promise<void> }>('auditLog')

// Non-admins get 403 from both; the page then shows a notice.
const [{ data: settings, error }, { data: users, refresh: refreshUsers }] = await Promise.all([
  useFetch<InstanceSettings>('/api/admin/settings'),
  useFetch<AdminUser[]>('/api/admin/users', { default: () => [] }),
])

// Settings form. Lists are edited as text, one entry per line or comma separated.
const mode = ref(settings.value?.signupMode ?? 'restricted')
const domains = ref(settings.value?.allowedDomains.join('\n') ?? '')
const emails = ref(settings.value?.allowedEmails.join('\n') ?? '')
const externalInvites = ref(settings.value?.allowExternalInvites ?? true)
const saving = ref(false)

const modes = computed(() => [
  { label: t('admin.restricted'), value: 'restricted', description: t('admin.restrictedDescription') },
  { label: t('admin.open'), value: 'open', description: t('admin.openDescription') },
])

async function save() {
  saving.value = true
  try {
    const s = await $fetch<InstanceSettings>('/api/admin/settings', {
      method: 'PUT',
      body: { signupMode: mode.value, allowedDomains: parseList(domains.value), allowedEmails: parseList(emails.value), allowExternalInvites: externalInvites.value },
    })
    domains.value = s.allowedDomains.join('\n')
    emails.value = s.allowedEmails.join('\n')
    toast.add({ title: t('admin.saved'), color: 'success' })
    await auditLog.value?.refresh()
  }
  catch (err) { showError(err, t('admin.saveFailed')) }
  finally { saving.value = false }
}

async function setAdmin(u: AdminUser, admin: boolean) {
  try {
    await $fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { admin } })
  }
  catch (err) { showError(err, t('admin.adminFailed')) }
  await Promise.all([refreshUsers(), auditLog.value?.refresh()])
}

const removing = ref<AdminUser | null>(null)
const removeOpen = computed({
  get: () => !!removing.value,
  set: (v) => { if (!v) removing.value = null },
})

async function confirmRemove() {
  try {
    await $fetch(`/api/admin/users/${removing.value!.id}`, { method: 'DELETE' })
    removing.value = null
    await Promise.all([refreshUsers(), auditLog.value?.refresh()])
  }
  catch (err) { showError(err, t('admin.removeFailed')) }
}
</script>

<template>
  <UContainer class="py-8 space-y-10 max-w-3xl">
    <h1 class="text-2xl font-semibold">
      {{ t('admin.title') }}
    </h1>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-shield-x" :title="t('admin.onlyAdmins')" />

    <template v-else>
      <section class="space-y-4">
        <h2 class="text-lg font-medium">
          {{ t('admin.signup') }}
        </h2>
        <form class="space-y-4" @submit.prevent="save">
          <UFormField :label="t('admin.whoCanSignUp')">
            <URadioGroup v-model="mode" :items="modes" />
          </UFormField>
          <template v-if="mode === 'restricted'">
            <UFormField :label="t('admin.domains')" :description="t('admin.domainsHelp')">
              <UTextarea v-model="domains" :rows="3" class="w-full" placeholder="example.com" />
            </UFormField>
            <UFormField :label="t('admin.emails')" :description="t('admin.emailsHelp')">
              <UTextarea v-model="emails" :rows="3" class="w-full" :placeholder="t('admin.emailsPlaceholder')" />
            </UFormField>
            <USwitch
              v-model="externalInvites"
              :label="t('admin.externalInvites')"
              :description="t('admin.externalInvitesHelp')"
            />
          </template>
          <UButton type="submit" :label="t('common.save')" :loading="saving" />
        </form>
        <p class="text-sm text-muted">
          {{ t('admin.rulesNote') }}
        </p>
      </section>

      <section class="space-y-2">
        <h2 class="text-lg font-medium">
          {{ t('admin.users') }}
        </h2>
        <ul class="divide-y divide-default">
          <li v-for="u in users" :key="u.id" class="flex items-center gap-3 py-3">
            <UUser
              :name="u.id === user?.id ? t('admin.you', { name: u.name }) : u.name"
              :description="u.email"
              :avatar="{ src: u.avatarUrl ?? undefined, alt: u.name }"
              class="flex-1 min-w-0"
            />
            <UBadge v-if="!u.verified" color="warning" variant="subtle" :label="t('admin.unconfirmed')" />
            <UBadge v-if="u.isAdmin" color="primary" variant="subtle" :label="t('admin.adminBadge')" />
            <UButton
              v-if="u.isAdmin"
              color="neutral"
              variant="ghost"
              size="sm"
              :label="t('admin.removeAdmin')"
              @click="setAdmin(u, false)"
            />
            <UButton
              v-else-if="u.verified"
              color="neutral"
              variant="ghost"
              size="sm"
              :label="t('admin.makeAdmin')"
              @click="setAdmin(u, true)"
            />
            <UButton
              v-if="u.id !== user?.id"
              color="error"
              variant="ghost"
              size="sm"
              icon="i-lucide-user-x"
              :aria-label="t('admin.removeUser')"
              @click="removing = u"
            />
          </li>
        </ul>
      </section>

      <AdminAuditLog ref="auditLog" />
    </template>

    <UModal
      v-model:open="removeOpen"
      :title="t('admin.removeTitle', { email: removing?.email })"
      :description="t('admin.removeDescription')"
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="removing = null" />
          <UButton color="error" :label="t('admin.removeUser')" @click="confirmRemove" />
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
