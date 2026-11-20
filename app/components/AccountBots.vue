<script setup lang="ts">
import { AvatarCropModal } from '#components'
import type { BoardSummary } from '#shared/types/board'
import type { AccountBot, AccountBotBoard, BotRole, BotToken } from '#shared/types/bots'

// The Bots tab on /account: bots of the signed-in person (0109_account_bots_rls.sql).
// They make, rename and delete them, set their picture, manage their tokens
// and add them to boards they own (as editor, commenter or viewer). Board
// owners change a bot's role or remove it in the board's members panel too.

const showError = useApiError()
const { t, locale } = useI18n()
const confirm = useConfirm()
const ask = usePrompt()

const { data: bots, refresh } = await useFetch<AccountBot[]>('/api/account/bots', { default: () => [] })

/** Boards the caller owns (not archived), to add bots to; loaded with the list. */
const { data: boards } = await useFetch<BoardSummary[]>('/api/boards', { default: () => [] })
const ownedBoards = computed(() => boards.value.filter(b => b.role === 'owner' && !b.archivedAt))

const roles = computed(() => (['editor', 'commenter', 'viewer'] as const).map(value => ({
  label: t(`members.roles.${value}`), value, description: t(`members.roleDescriptions.${value}`),
})) satisfies { label: string, value: BotRole, description: string }[])

function replace(bot: AccountBot) {
  bots.value = bots.value.map(b => b.id === bot.id ? bot : b)
}

const liveTokens = (bot: AccountBot) =>
  bot.tokens.filter(tk => !tk.revokedAt && !(tk.expiresAt && new Date(tk.expiresAt) <= new Date()))

// Add form
const name = ref('')
const adding = ref(false)

async function add() {
  if (!name.value.trim()) return
  adding.value = true
  try {
    const bot = await $fetch<AccountBot>('/api/account/bots', { method: 'POST', body: { name: name.value.trim() } })
    bots.value = [...bots.value, bot].sort((a, b) => a.name.localeCompare(b.name, locale.value))
    name.value = ''
  }
  catch (err) { showError(err, t('bots.addFailed')) }
  finally { adding.value = false }
}

async function rename(bot: AccountBot) {
  const value = (await ask({ title: t('bots.rename'), label: t('common.name'), initial: bot.name, maxlength: 100 }))?.trim()
  if (!value || value === bot.name) return
  try {
    replace(await $fetch<AccountBot>(`/api/bots/${bot.id}`, { method: 'PATCH', body: { name: value } }))
  }
  catch (err) { showError(err, t('bots.updateFailed')) }
}

async function remove(bot: AccountBot) {
  if (!await confirm({ title: t('bots.deleteConfirm', { name: bot.name }), description: t('bots.deleteDescription'), confirmLabel: t('common.delete'), color: 'error' })) return
  try {
    await $fetch(`/api/bots/${bot.id}`, { method: 'DELETE' })
    bots.value = bots.value.filter(b => b.id !== bot.id)
  }
  catch (err) { showError(err, t('bots.deleteFailed')) }
}

// Boards
const addBoard = ref<Record<string, string | undefined>>({})
const addRole = ref<Record<string, BotRole>>({})
const boardItems = (bot: AccountBot) => ownedBoards.value
  .filter(b => !bot.boards.some(x => x.id === b.id))
  .map(b => ({ label: b.name, value: b.id }))

async function putBoard(bot: AccountBot, boardId: string, role: BotRole) {
  try {
    replace(await $fetch<AccountBot>(`/api/account/bots/${bot.id}/boards/${boardId}`, { method: 'PUT', body: { role } }))
    return true
  }
  catch (err) {
    showError(err, t('bots.account.boardFailed'))
    await refresh()
    return false
  }
}

async function addToBoard(bot: AccountBot) {
  const boardId = addBoard.value[bot.id]
  if (!boardId) return
  if (await putBoard(bot, boardId, addRole.value[bot.id] ?? 'editor')) addBoard.value[bot.id] = undefined
}

async function removeFromBoard(bot: AccountBot, board: AccountBotBoard) {
  if (!await confirm({ title: t('bots.account.removeConfirm', { name: bot.name, board: board.name }), confirmLabel: t('members.remove'), color: 'error' })) return
  try {
    replace(await $fetch<AccountBot>(`/api/account/bots/${bot.id}/boards/${board.id}`, { method: 'DELETE' }))
  }
  catch (err) { showError(err, t('members.removeFailed')) }
}

// Profile picture: cropped and scaled down in the browser like the account's own.
const overlay = useOverlay()
const toast = useToast()
const pictureInput = useTemplateRef<HTMLInputElement>('pictureInput')
const pictureBot = ref<AccountBot | null>(null)
const savingPicture = ref<string | null>(null)

function pickPicture(bot: AccountBot) {
  pictureBot.value = bot
  pictureInput.value?.click()
}

async function onPicture(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const bot = pictureBot.value
  if (!file || !bot) return
  if (!AVATAR_TYPES.includes(file.type)) {
    toast.add({ title: t('account.profile.pictureWrongType'), color: 'error' })
    return
  }
  const cropped = await overlay.create(AvatarCropModal, { destroyOnClose: true }).open({ file }).result
  if (!cropped) return
  savingPicture.value = bot.id
  try {
    const form = new FormData()
    form.append('file', cropped, 'avatar')
    replace(await $fetch<AccountBot>(`/api/bots/${bot.id}/avatar`, { method: 'POST', body: form }))
  }
  catch (err) { showError(err, t('account.profile.pictureFailed')) }
  finally { savingPicture.value = null }
}

async function removePicture(bot: AccountBot) {
  savingPicture.value = bot.id
  try {
    replace(await $fetch<AccountBot>(`/api/bots/${bot.id}/avatar`, { method: 'DELETE' }))
  }
  catch (err) { showError(err, t('account.profile.pictureRemoveFailed')) }
  finally { savingPicture.value = null }
}

const pictureItems = (bot: AccountBot) => [
  { label: bot.avatarUrl ? t('account.profile.pictureChange') : t('account.profile.pictureUpload'), icon: 'i-lucide-image-up', onSelect: () => pickPicture(bot) },
  ...bot.avatarUrl ? [{ label: t('account.profile.pictureRemove'), icon: 'i-lucide-trash-2', onSelect: () => removePicture(bot) }] : [],
]

// New token dialog
const tokenBot = ref<AccountBot | null>(null)
const tokenOpen = ref(false)
const tokenName = ref('')
const access = ref<'read' | 'write'>('write')
const expiry = ref<'30' | '90' | '365' | 'never'>('never')
const creating = ref(false)
/** The new token, shown once. */
const created = ref<string | null>(null)

const accessItems = computed(() => [
  { label: t('tokens.readOnly'), value: 'read', description: t('bots.account.readOnlyDescription') },
  { label: t('tokens.readWrite'), value: 'write', description: t('bots.account.readWriteDescription') },
])
const expiryItems = computed(() => [
  { label: t('tokens.days30'), value: '30' },
  { label: t('tokens.days90'), value: '90' },
  { label: t('tokens.year'), value: '365' },
  { label: t('tokens.never'), value: 'never' },
])

function openToken(bot: AccountBot) {
  tokenBot.value = bot
  tokenName.value = ''
  access.value = 'write'
  expiry.value = 'never'
  created.value = null
  tokenOpen.value = true
}

async function createToken() {
  const bot = tokenBot.value
  if (!bot || !tokenName.value.trim()) return
  creating.value = true
  try {
    const { token, ...meta } = await $fetch<BotToken & { token: string }>(`/api/bots/${bot.id}/tokens`, {
      method: 'POST',
      body: {
        name: tokenName.value.trim(),
        scopes: access.value === 'write' ? ['read', 'write'] : ['read'],
        expiresInDays: expiry.value === 'never' ? null : Number(expiry.value),
      },
    })
    const current = bots.value.find(b => b.id === bot.id)
    if (current) replace({ ...current, tokens: [meta, ...current.tokens] })
    created.value = token
  }
  catch (err) { showError(err, t('tokens.createFailed')) }
  finally { creating.value = false }
}

// Show token again dialog
const reveal = ref<{ bot: AccountBot, token: BotToken } | null>(null)
const revealOpen = ref(false)
function openReveal(bot: AccountBot, token: BotToken) {
  reveal.value = { bot, token }
  revealOpen.value = true
}

async function revoke(bot: AccountBot, token: BotToken) {
  if (!await confirm({ title: t('bots.revokeConfirm', { name: token.name }), confirmLabel: t('tokens.revoke'), color: 'error' })) return
  try {
    await $fetch(`/api/bots/${bot.id}/tokens/${token.id}`, { method: 'DELETE' })
    const current = bots.value.find(b => b.id === bot.id)
    if (current) replace({ ...current, tokens: current.tokens.filter(tk => tk.id !== token.id) })
  }
  catch (err) { showError(err, t('tokens.revokeFailed')) }
}
</script>

<template>
  <section class="space-y-4">
    <div>
      <h2 class="text-lg font-medium">
        {{ t('bots.title') }}
      </h2>
      <p class="text-sm text-muted">
        {{ t('bots.account.description') }}
      </p>
    </div>

    <form class="flex gap-2" data-testid="add-account-bot" @submit.prevent="add">
      <UInput v-model="name" :placeholder="t('bots.namePlaceholder')" :aria-label="t('common.name')" icon="i-lucide-bot" maxlength="100" class="flex-1" />
      <UButton type="submit" icon="i-lucide-plus" :label="t('bots.add')" :loading="adding" :disabled="!name.trim()" />
    </form>

    <p v-if="!bots.length" class="text-sm text-muted">
      {{ t('bots.empty') }}
    </p>
    <ul v-else class="divide-y divide-default">
      <li v-for="bot in bots" :key="bot.id" class="py-4 space-y-3" data-testid="account-bot">
        <div class="flex items-center gap-3">
          <UDropdownMenu :items="pictureItems(bot)">
            <button
              type="button"
              class="group relative shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :aria-label="t('bots.picture', { name: bot.name })"
              :aria-busy="savingPicture === bot.id"
              :disabled="savingPicture === bot.id"
            >
              <UAvatar v-bind="personAvatar({ ...bot, isBot: true })" size="xl" />
              <span
                class="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white transition-opacity"
                :class="savingPicture === bot.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'"
              >
                <UIcon :name="savingPicture === bot.id ? 'i-lucide-loader-circle' : 'i-lucide-camera'" class="size-4" :class="{ 'animate-spin': savingPicture === bot.id }" />
              </span>
            </button>
          </UDropdownMenu>
          <span class="flex-1 min-w-0 truncate text-sm font-medium">{{ bot.name }}</span>
          <UTooltip :text="t('bots.rename')">
            <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-pencil" :aria-label="t('bots.rename')" @click="rename(bot)" />
          </UTooltip>
          <UTooltip :text="t('bots.delete')">
            <UButton color="error" variant="ghost" size="sm" icon="i-lucide-trash" :aria-label="t('bots.delete')" @click="remove(bot)" />
          </UTooltip>
        </div>

        <div class="ms-13 space-y-2">
          <h3 class="text-xs font-medium text-muted uppercase">
            {{ t('bots.account.boards') }}
          </h3>
          <p v-if="!bot.boards.length" class="text-sm text-muted">
            {{ t('bots.account.noBoards') }}
          </p>
          <ul v-else class="space-y-1">
            <li v-for="b in bot.boards" :key="b.id" class="flex items-center gap-2" data-testid="account-bot-board">
              <UIcon name="i-lucide-square-kanban" class="size-4 text-muted shrink-0" />
              <NuxtLink :to="`/boards/${b.id}`" class="flex-1 min-w-0 truncate text-sm hover:underline">
                {{ b.name }}
              </NuxtLink>
              <USelect
                v-if="b.owner"
                :model-value="b.role"
                :items="roles"
                size="xs"
                class="w-28"
                :aria-label="t('bots.role')"
                @update:model-value="(r: BotRole) => putBoard(bot, b.id, r)"
              />
              <UBadge v-else color="neutral" variant="subtle" size="sm" :label="t(`members.roles.${b.role}`)" />
              <UTooltip :text="t('members.remove')">
                <UButton color="error" variant="ghost" size="xs" icon="i-lucide-x" :aria-label="t('members.remove')" @click="removeFromBoard(bot, b)" />
              </UTooltip>
            </li>
          </ul>
          <form v-if="boardItems(bot).length" class="flex flex-wrap gap-2" @submit.prevent="addToBoard(bot)">
            <USelectMenu
              v-model="addBoard[bot.id]"
              :items="boardItems(bot)"
              value-key="value"
              :placeholder="t('bots.account.pickBoard')"
              :aria-label="t('bots.account.pickBoard')"
              size="xs"
              class="flex-1 min-w-40"
            />
            <USelect
              :model-value="addRole[bot.id] ?? 'editor'"
              :items="roles"
              size="xs"
              class="w-28"
              :aria-label="t('bots.role')"
              @update:model-value="(r: BotRole) => addRole[bot.id] = r"
            />
            <UButton type="submit" size="xs" icon="i-lucide-plus" :label="t('bots.account.addToBoard')" :disabled="!addBoard[bot.id]" />
          </form>
        </div>

        <div class="ms-13 space-y-2">
          <h3 class="text-xs font-medium text-muted uppercase">
            {{ t('tokens.title') }}
          </h3>
          <ul v-if="liveTokens(bot).length" class="space-y-1">
            <li v-for="tk in liveTokens(bot)" :key="tk.id" class="flex items-center gap-2" data-testid="account-bot-token">
              <UIcon name="i-lucide-key-round" class="size-4 text-muted shrink-0" />
              <div class="flex-1 min-w-0">
                <p class="text-sm truncate">
                  {{ tk.name }}
                  <UBadge
                    :color="tk.scopes.includes('write') ? 'warning' : 'neutral'"
                    variant="subtle"
                    size="sm"
                    :label="tk.scopes.includes('write') ? t('tokens.readWrite') : t('tokens.readOnly')"
                    class="ms-1"
                  />
                </p>
                <p class="text-xs text-muted truncate">
                  <code>{{ tk.prefix }}…</code>
                  · {{ tk.lastUsedAt ? t('tokens.lastUsed', { date: formatDateTime(tk.lastUsedAt, locale) }) : t('tokens.neverUsed') }}
                  · {{ tk.expiresAt ? t('tokens.expires', { date: formatDateTime(tk.expiresAt, locale) }) : t('tokens.noExpiry') }}
                  <template v-if="tk.lastViewedAt">
                    · {{ t('tokens.lastViewed', { date: formatDateTime(tk.lastViewedAt, locale) }) }}
                  </template>
                </p>
              </div>
              <UTooltip v-if="tk.viewable" :text="t('tokens.reveal.button')">
                <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-eye" :aria-label="t('tokens.reveal.button')" data-testid="reveal-token" @click="openReveal(bot, tk)" />
              </UTooltip>
              <UButton color="neutral" variant="ghost" size="xs" :label="t('tokens.revoke')" @click="revoke(bot, tk)" />
            </li>
          </ul>
          <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-key-round" :label="t('tokens.new')" @click="openToken(bot)" />
        </div>
      </li>
    </ul>

    <input ref="pictureInput" type="file" :accept="AVATAR_TYPES.join(',')" class="hidden" :aria-label="t('account.profile.picture')" @change="onPicture">

    <UModal v-model:open="tokenOpen" :title="created ? t('tokens.copyTitle') : t('bots.newTokenTitle', { name: tokenBot?.name ?? '' })">
      <template #body>
        <TokenCreatedPanel v-if="created" :token="created" :warning="t('bots.account.onlyOnceDescription', { name: tokenBot?.name ?? '' })" />
        <form v-else id="new-account-bot-token" class="space-y-4" @submit.prevent="createToken">
          <UFormField :label="t('common.name')" :description="t('tokens.nameHelp')">
            <UInput v-model="tokenName" class="w-full" maxlength="100" required autofocus />
          </UFormField>
          <UFormField :label="t('tokens.access')">
            <URadioGroup v-model="access" :items="accessItems" />
          </UFormField>
          <UFormField :label="t('tokens.expiresLabel')">
            <USelect v-model="expiry" :items="expiryItems" class="w-40" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton v-if="created" :label="t('common.done')" @click="tokenOpen = false" />
          <template v-else>
            <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="tokenOpen = false" />
            <UButton type="submit" form="new-account-bot-token" :label="t('tokens.create')" :loading="creating" :disabled="!tokenName.trim()" />
          </template>
        </div>
      </template>
    </UModal>
    <TokenRevealModal
      v-if="reveal"
      v-model:open="revealOpen"
      :name="reveal.token.name"
      :url="`/api/bots/${reveal.bot.id}/tokens/${reveal.token.id}/reveal`"
      :warning="t('bots.account.onlyOnceDescription', { name: reveal?.bot.name ?? '' })"
      @revealed="reveal.token.lastViewedAt = new Date().toISOString()"
    />
  </section>
</template>
