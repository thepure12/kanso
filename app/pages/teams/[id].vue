<script setup lang="ts">
import type { TeamDetail } from '#shared/types/board'

const route = useRoute()
const { t } = useI18n()
const confirm = useConfirm()
const ask = usePrompt()
const id = route.params.id as string
const { data: team, error, refresh } = await useFetch<TeamDetail>(`/api/teams/${id}`)
if (error.value) throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: t('teams.notFound'), fatal: true })

useHead({ title: () => team.value?.name ?? t('teams.fallbackTitle') })

const { user } = useUserSession()
const showError = useApiError()
const toggleStar = useBoardStar()
const roleColor = { owner: 'primary', editor: 'success', viewer: 'neutral' } as const

// Cosmetic only: RLS decides what the team's owners and members may do.
const isOwner = computed(() => team.value?.role === 'owner')
const canCreate = computed(() => team.value?.role === 'owner' || team.value?.role === 'editor')
const activeBoards = computed(() => team.value?.boards.filter(b => !b.archivedAt) ?? [])
const archivedBoards = computed(() => team.value?.boards.filter(b => b.archivedAt) ?? [])
const showArchived = ref(false)

async function rename() {
  const name = (await ask({ title: t('teams.rename'), label: t('teams.namePrompt'), initial: team.value?.name }))?.trim()
  if (!name) return
  try {
    await $fetch(`/api/teams/${id}`, { method: 'PATCH', body: { name } })
    team.value!.name = name
  }
  catch (err) { showError(err, t('teams.renameFailed')) }
}

async function leave() {
  if (!await confirm({ title: t('teams.leaveConfirm', { team: team.value?.name }), confirmLabel: t('teams.leave') })) return
  try {
    await $fetch(`/api/teams/${id}/members/${user.value!.id}`, { method: 'DELETE' })
    await navigateTo('/')
  }
  catch (err) { showError(err, t('teams.leaveFailed')) }
}

const deleteOpen = ref(false)
async function deleteTeam() {
  try {
    await $fetch(`/api/teams/${id}`, { method: 'DELETE' })
    await navigateTo('/')
  }
  catch (err) { showError(err, t('teams.deleteFailed')) }
}

const menu = computed(() => [
  ...(isOwner.value ? [[{ label: t('teams.rename'), icon: 'i-lucide-pencil', onSelect: rename }]] : []),
  [{ label: t('teams.leave'), icon: 'i-lucide-log-out', onSelect: leave }],
  ...(isOwner.value ? [[{ label: t('teams.delete'), icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => { deleteOpen.value = true } }]] : []),
])
</script>

<template>
  <UContainer v-if="team" class="py-8 space-y-10">
    <div class="flex flex-wrap items-center gap-3">
      <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" :aria-label="t('teams.allBoards')" />
      <UIcon name="i-lucide-users" class="size-6 text-muted" />
      <h1 class="text-2xl font-semibold truncate">
        {{ team.name }}
      </h1>
      <UBadge :color="roleColor[team.role]" variant="subtle" :label="t(`members.roles.${team.role}`)" />
      <UDropdownMenu :items="menu">
        <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" :aria-label="t('teams.actions')" class="ms-auto" />
      </UDropdownMenu>
    </div>

    <section>
      <div class="flex items-center gap-3 mb-4">
        <h2 class="text-lg font-semibold">
          {{ t('teams.boards') }}
        </h2>
        <UButton v-if="canCreate" size="sm" color="neutral" variant="ghost" icon="i-lucide-plus" :label="t('teams.board')" :to="{ path: '/', query: { new: 'board', team: team.id } }" class="ms-auto" />
      </div>
      <BoardGrid v-if="activeBoards.length" :boards="activeBoards" @star="toggleStar" />
      <p v-else class="text-sm text-muted">
        {{ t('teams.noBoards') }}
      </p>
      <div v-if="archivedBoards.length" class="mt-4">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-archive"
          :trailing-icon="showArchived ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          :label="t('teams.archived', { count: archivedBoards.length })"
          @click="showArchived = !showArchived"
        />
        <BoardGrid v-if="showArchived" :boards="archivedBoards" class="mt-4" @star="toggleStar" />
      </div>
    </section>

    <section class="max-w-2xl">
      <h2 class="text-lg font-semibold mb-1">
        {{ t('teams.members') }}
      </h2>
      <p class="text-sm text-muted mb-4">
        {{ t('teams.rolesHelp') }}
      </p>
      <MembersPanel
        :endpoint="`/api/teams/${team.id}/members`"
        :members="team.members"
        :invites="team.invites"
        :invites-endpoint="`/api/teams/${team.id}/invites`"
        :can-manage="isOwner"
        @changed="refresh"
        @left="navigateTo('/')"
      />
    </section>

    <UModal v-model:open="deleteOpen" :title="t('teams.deleteTitle', { team: team.name })" :description="t('teams.deleteDescription')">
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="deleteOpen = false" />
          <UButton color="error" :label="t('teams.delete')" @click="deleteTeam" />
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
