<script setup lang="ts">
import type { BoardRole, Invite, Person } from '#shared/types/board'

// Member list of a board or team: add by email (or invite), change roles,
// remove, leave, revoke invites. Used by MembersSlideover and the team page.

export interface PanelMember extends Person {
  /** Role managed by this panel; null when access comes only from elsewhere (a team). */
  role: BoardRole | null
  /** Extra access shown read-only, e.g. "Acme · editor". */
  note?: string
}

const props = defineProps<{
  /** Base URL of the members API, e.g. /api/teams/:id/members */
  endpoint: string
  members: PanelMember[]
  /** Pending invites for emails without an account. */
  invites: Invite[]
  /** Base URL of the invites API, e.g. /api/teams/:id/invites */
  invitesEndpoint: string
  canManage: boolean
}>()
const emit = defineEmits<{ changed: [], left: [] }>()

const { user } = useUserSession()
const showError = useApiError()
const toast = useToast()
const { t } = useI18n()

const roles = computed(() => (['owner', 'editor', 'viewer'] as const).map(value => ({
  label: t(`members.roles.${value}`), value, description: t(`members.roleDescriptions.${value}`),
})) satisfies { label: string, value: BoardRole, description: string }[])

const email = ref('')
const role = ref<BoardRole>('editor')
const adding = ref(false)

async function add() {
  if (!email.value.trim()) return
  adding.value = true
  try {
    const res = await $fetch<{ invited?: true }>(props.endpoint, { method: 'POST', body: { email: email.value.trim(), role: role.value } })
    toast.add(res.invited
      ? { title: t('members.invited', { email: email.value }), description: t('members.invitedDescription'), color: 'success' }
      : { title: t('members.added', { email: email.value }), color: 'success' })
    email.value = ''
    emit('changed')
  }
  catch (err) { showError(err, t('members.addFailed')) }
  finally { adding.value = false }
}

async function setRole(userId: string, newRole: BoardRole) {
  try {
    await $fetch(`${props.endpoint}/${userId}`, { method: 'PATCH', body: { role: newRole } })
  }
  catch (err) { showError(err, t('members.roleFailed')) }
  emit('changed')
}

async function remove(userId: string) {
  try {
    await $fetch(`${props.endpoint}/${userId}`, { method: 'DELETE' })
    if (userId === user.value?.id) emit('left')
    else emit('changed')
  }
  catch (err) { showError(err, t('members.removeFailed')) }
}

async function revoke(inviteId: string) {
  try {
    await $fetch(`${props.invitesEndpoint}/${inviteId}`, { method: 'DELETE' })
  }
  catch (err) { showError(err, t('members.revokeFailed')) }
  emit('changed')
}
</script>

<template>
  <div>
    <form v-if="props.canManage" class="flex flex-col gap-2 mb-6" @submit.prevent="add">
      <UInput v-model="email" type="email" :placeholder="t('members.emailPlaceholder')" icon="i-lucide-mail" />
      <div class="flex gap-2">
        <USelect v-model="role" :items="roles" class="flex-1" />
        <UButton type="submit" icon="i-lucide-user-plus" :label="t('members.add')" :loading="adding" />
      </div>
    </form>

    <ul class="divide-y divide-default">
      <li v-for="m in props.members" :key="m.userId" class="flex items-center gap-3 py-3">
        <UUser
          :name="m.userId === user?.id ? t('members.you', { name: m.name }) : m.name"
          :description="m.email"
          :avatar="{ src: m.avatarUrl ?? undefined, alt: m.name }"
          class="flex-1 min-w-0"
        />
        <UBadge v-if="m.note" color="neutral" variant="outline" size="sm" icon="i-lucide-users" :label="m.note" />
        <template v-if="m.role">
          <USelect
            v-if="props.canManage"
            :model-value="m.role"
            :items="roles"
            size="sm"
            class="w-28"
            @update:model-value="(r: BoardRole) => setRole(m.userId, r)"
          />
          <UBadge v-else color="neutral" variant="subtle" :label="t(`members.roles.${m.role}`)" />
          <UButton
            v-if="props.canManage || m.userId === user?.id"
            color="error"
            variant="ghost"
            size="sm"
            :icon="m.userId === user?.id ? 'i-lucide-log-out' : 'i-lucide-user-minus'"
            :aria-label="m.userId === user?.id ? t('members.leave') : t('members.remove')"
            @click="remove(m.userId)"
          />
        </template>
      </li>
    </ul>

    <template v-if="props.invites.length">
      <h3 class="text-sm font-medium text-muted mt-6 mb-1">
        {{ t('members.pending') }}
      </h3>
      <ul class="divide-y divide-default">
        <li v-for="i in props.invites" :key="i.id" class="flex items-center gap-3 py-3">
          <UUser :name="i.email" :description="t('members.notSignedUp')" :avatar="{ icon: 'i-lucide-mail' }" class="flex-1 min-w-0" />
          <UBadge color="neutral" variant="subtle" :label="t(`members.roles.${i.role}`)" />
          <UButton
            v-if="props.canManage"
            color="error"
            variant="ghost"
            size="sm"
            icon="i-lucide-x"
            :aria-label="t('members.revoke')"
            @click="revoke(i.id)"
          />
        </li>
      </ul>
    </template>
  </div>
</template>
