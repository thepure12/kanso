<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { AdminUser, InstanceSettings } from '#shared/types/admin'
import { parseList } from '#shared/signup'

const { user } = useUserSession()
const showError = useApiError()
const toast = useToast()
const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
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

// Tab, kept in ?tab= (users is the default and leaves the query out).
const tab = computed<AdminTab>({
  get: () => adminTabFrom(route.query.tab),
  set: v => router.replace({ query: { ...route.query, tab: v === 'users' ? undefined : v } }),
})
const tabs = computed(() => [
  { label: t('admin.users'), value: 'users', icon: 'i-lucide-users', badge: users.value.length },
  { label: t('admin.signup'), value: 'signup', icon: 'i-lucide-door-open' },
  { label: t('audit.title'), value: 'audit', icon: 'i-lucide-scroll-text' },
])

const search = ref('')
const matchingUsers = computed(() => filterAdminUsers(users.value, search.value))
const pageSize = 50
const userPage = ref(1)
watch(search, () => { userPage.value = 1 })
const shownUsers = computed(() => matchingUsers.value.slice((userPage.value - 1) * pageSize, userPage.value * pageSize))
// The user column takes the spare width and truncates long emails; joined is hidden on phones.
const columns = computed<TableColumn<AdminUser>[]>(() => [
  { id: 'user', header: t('admin.columnUser'), meta: { class: { td: 'w-full max-w-0 overflow-hidden' } } },
  { id: 'role', header: t('admin.columnRole') },
  { id: 'joined', header: t('admin.columnJoined'), meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' } } },
  { id: 'actions', header: '', meta: { class: { td: 'text-right' } } },
])

function joined(u: AdminUser) {
  return new Date(u.createdAt).toLocaleDateString(locale.value, { dateStyle: 'medium' })
}

function userActions(u: AdminUser): DropdownMenuItem[][] {
  const rights: DropdownMenuItem[] = u.isAdmin
    ? [{ label: t('admin.removeAdmin'), icon: 'i-lucide-shield-minus', onSelect: () => setAdmin(u, false) }]
    : u.verified ? [{ label: t('admin.makeAdmin'), icon: 'i-lucide-shield-plus', onSelect: () => setAdmin(u, true) }] : []
  const remove: DropdownMenuItem[] = u.id === user.value?.id
    ? []
    : [{ label: t('admin.removeUser'), icon: 'i-lucide-user-x', color: 'error', onSelect: () => { removing.value = u } }]
  return [rights, remove].filter(g => g.length)
}

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
  <UContainer class="py-8 space-y-6 max-w-4xl">
    <h1 class="text-2xl font-semibold">
      {{ t('admin.title') }}
    </h1>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-shield-x" :title="t('admin.onlyAdmins')" />

    <template v-else>
      <UTabs v-model="tab" :items="tabs" :content="false" variant="link" class="w-full" :ui="{ trigger: 'flex-none', leadingIcon: 'hidden sm:inline-flex' }" />

      <!-- v-show, not tab content: keeps the settings form and the audit log mounted. -->
      <section v-show="tab === 'users'" class="space-y-4">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          :placeholder="t('admin.searchUsers')"
          :aria-label="t('admin.searchUsers')"
          class="w-full sm:max-w-xs"
        />
        <UTable
          :data="shownUsers"
          :columns="columns"
          :empty="t('admin.noUsersMatch')"
          :ui="{ td: 'py-2' }"
        >
          <template #user-cell="{ row: { original: u } }">
            <UUser
              :name="u.id === user?.id ? t('admin.you', { name: u.name }) : u.name"
              :description="u.email"
              :avatar="{ src: u.avatarUrl ?? undefined, alt: u.name }"
              class="min-w-0"
              :ui="{ wrapper: 'min-w-0', name: 'truncate', description: 'truncate' }"
            />
          </template>
          <template #role-cell="{ row: { original: u } }">
            <div class="flex gap-1">
              <UBadge v-if="u.isAdmin" color="primary" variant="subtle" :label="t('admin.adminBadge')" />
              <UBadge v-if="!u.verified" color="warning" variant="subtle" :label="t('admin.unconfirmed')" />
              <span v-if="!u.isAdmin && u.verified" class="text-muted">{{ t('admin.memberRole') }}</span>
            </div>
          </template>
          <template #joined-cell="{ row: { original: u } }">
            <time class="text-muted" :datetime="u.createdAt">{{ joined(u) }}</time>
          </template>
          <template #actions-cell="{ row: { original: u } }">
            <UDropdownMenu v-if="userActions(u).length" :items="userActions(u)" :content="{ align: 'end' }">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-ellipsis"
                :aria-label="t('admin.userActions', { name: u.name })"
              />
            </UDropdownMenu>
          </template>
        </UTable>
        <UPagination
          v-if="matchingUsers.length > pageSize"
          v-model:page="userPage"
          :total="matchingUsers.length"
          :items-per-page="pageSize"
        />
      </section>

      <section v-show="tab === 'signup'" class="space-y-4">
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

      <AdminAuditLog v-show="tab === 'audit'" ref="auditLog" />
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
