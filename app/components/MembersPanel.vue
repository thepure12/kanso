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
const listId = useId()

const roles = computed(() => (['owner', 'editor', 'viewer'] as const).map(value => ({
  label: t(`members.roles.${value}`), value, description: t(`members.roleDescriptions.${value}`),
})) satisfies { label: string, value: BoardRole, description: string }[])

const email = ref('')
const role = ref<BoardRole>('editor')
const adding = ref(false)

// Suggestions: people the caller already shares a board or team with (RLS
// decides), fetched 300 ms after typing stops, minus current members and invites.
const SUGGEST_DELAY = 300
const people = ref<Person[]>([])
const suggestOpen = ref(false)
const highlighted = ref(-1)
let suggestTimer: ReturnType<typeof setTimeout> | undefined
let suggestSeq = 0

const suggestions = computed(() => {
  const taken = new Set([
    ...props.members.map(m => m.email.toLowerCase()),
    ...props.invites.map(i => i.email.toLowerCase()),
  ])
  return people.value.filter(p => !taken.has(p.email.toLowerCase()))
})
const showSuggestions = computed(() => suggestOpen.value && suggestions.value.length > 0)

async function loadSuggestions() {
  const seq = ++suggestSeq
  try {
    const res = await $fetch<Person[]>('/api/people', { query: { q: email.value.trim() } })
    if (seq !== suggestSeq) return
    people.value = res
    highlighted.value = -1
  }
  catch { if (seq === suggestSeq) people.value = [] }
}

function scheduleSuggestions() {
  clearTimeout(suggestTimer)
  suggestTimer = setTimeout(loadSuggestions, SUGGEST_DELAY)
}

function onEmailInput() {
  suggestOpen.value = true
  scheduleSuggestions()
}

function onEmailFocus() {
  suggestOpen.value = true
  if (!people.value.length) scheduleSuggestions()
}

function closeSuggestions() {
  suggestOpen.value = false
  highlighted.value = -1
}

function pick(p: Person) {
  email.value = p.email
  closeSuggestions()
}

function onEmailKeydown(e: KeyboardEvent) {
  if (!showSuggestions.value) return
  const n = suggestions.value.length
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlighted.value = (highlighted.value + 1) % n
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlighted.value = (highlighted.value - 1 + n) % n
  }
  else if (e.key === 'Enter' && highlighted.value >= 0) {
    e.preventDefault()
    pick(suggestions.value[highlighted.value]!)
  }
  else if (e.key === 'Escape') {
    // Close the list, not the surrounding slideover.
    e.preventDefault()
    e.stopPropagation()
    closeSuggestions()
  }
}

onBeforeUnmount(() => clearTimeout(suggestTimer))

async function add() {
  if (!email.value.trim()) return
  adding.value = true
  try {
    const res = await $fetch<{ invited?: true }>(props.endpoint, { method: 'POST', body: { email: email.value.trim(), role: role.value } })
    toast.add(res.invited
      ? { title: t('members.invited', { email: email.value }), description: t('members.invitedDescription'), color: 'success' }
      : { title: t('members.added', { email: email.value }), color: 'success' })
    email.value = ''
    people.value = []
    closeSuggestions()
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
      <div class="relative">
        <UInput
          v-model="email"
          type="email"
          :placeholder="t('members.emailPlaceholder')"
          icon="i-lucide-mail"
          autocomplete="off"
          class="w-full"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="showSuggestions"
          :aria-controls="showSuggestions ? listId : undefined"
          :aria-activedescendant="showSuggestions && highlighted >= 0 ? `${listId}-${highlighted}` : undefined"
          @input="onEmailInput"
          @focus="onEmailFocus"
          @blur="closeSuggestions"
          @keydown="onEmailKeydown"
        />
        <ul
          v-if="showSuggestions"
          :id="listId"
          role="listbox"
          :aria-label="t('members.suggestions')"
          class="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-default bg-default shadow-lg py-1"
        >
          <li
            v-for="(p, i) in suggestions"
            :id="`${listId}-${i}`"
            :key="p.userId"
            role="option"
            :aria-selected="i === highlighted"
            class="px-2 py-1.5 cursor-pointer"
            :class="i === highlighted ? 'bg-elevated' : 'hover:bg-elevated/50'"
            @mousedown.prevent="pick(p)"
            @mouseenter="highlighted = i"
          >
            <UUser :name="p.name" :description="p.email" :avatar="{ src: p.avatarUrl ?? undefined, alt: p.name }" size="sm" />
          </li>
        </ul>
      </div>
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
          <UTooltip v-if="props.canManage || m.userId === user?.id" :text="m.userId === user?.id ? t('members.leave') : t('members.remove')">
            <UButton
              color="error"
              variant="ghost"
              size="sm"
              :icon="m.userId === user?.id ? 'i-lucide-log-out' : 'i-lucide-user-minus'"
              :aria-label="m.userId === user?.id ? t('members.leave') : t('members.remove')"
              @click="remove(m.userId)"
            />
          </UTooltip>
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
          <UTooltip v-if="props.canManage" :text="t('members.revoke')">
            <UButton
              color="error"
              variant="ghost"
              size="sm"
              icon="i-lucide-x"
              :aria-label="t('members.revoke')"
              @click="revoke(i.id)"
            />
          </UTooltip>
        </li>
      </ul>
    </template>
  </div>
</template>
