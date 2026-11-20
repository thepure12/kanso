<script setup lang="ts">
import { AvatarCropModal } from '#components'
import type { BoardBot, BotRole, BotToken } from '#shared/types/bots'

// Board owners manage the board's bots and their API tokens (Bots 2/4 routes,
// cookie only); with `teamId` instead, team owners manage the team's bots
// (team page). The list starts from BoardDetail.bots / TeamDetail.bots and
// follows its reloads; `changed` asks the page to reload (bots are members too);
// `limit` asks it to open MemberAccessModal for a bot, as for any other member.
const props = defineProps<{ boardId?: string, teamId?: string, bots: BoardBot[], limitedIds?: string[], canLimit?: boolean }>()
const emit = defineEmits<{ changed: [], limit: [botId: string] }>()
const open = defineModel<boolean>('open', { required: true })

const showError = useApiError()
const { t, locale } = useI18n()
const confirm = useConfirm()
const ask = usePrompt()

const team = computed(() => !!props.teamId)
const addUrl = computed(() => props.teamId ? `/api/teams/${props.teamId}/bots` : `/api/boards/${props.boardId}/bots`)

const list = ref<BoardBot[]>([...props.bots])
watch(() => props.bots, (bots) => { list.value = [...bots] })

const roles = computed(() => (['editor', 'commenter', 'viewer'] as const).map(value => ({
  label: t(`members.roles.${value}`), value, description: t(`members.roleDescriptions.${value}`),
})) satisfies { label: string, value: BotRole, description: string }[])

function replace(bot: BoardBot) {
  list.value = list.value.map(b => b.id === bot.id ? bot : b)
}

const liveTokens = (bot: BoardBot) =>
  (bot.tokens ?? []).filter(tk => !tk.revokedAt && !(tk.expiresAt && new Date(tk.expiresAt) <= new Date()))

// Add form
const name = ref('')
const role = ref<BotRole>('editor')
const adding = ref(false)

async function add() {
  if (!name.value.trim()) return
  adding.value = true
  try {
    const bot = await api<BoardBot>(addUrl.value, { method: 'POST', body: { name: name.value.trim(), role: role.value } })
    list.value = [...list.value, bot].sort((a, b) => a.name.localeCompare(b.name, locale.value))
    name.value = ''
    emit('changed')
  }
  catch (err) { showError(err, t('bots.addFailed')) }
  finally { adding.value = false }
}

async function patch(bot: BoardBot, body: { name?: string, role?: BotRole }) {
  try {
    replace(await api<BoardBot>(`/api/bots/${bot.id}`, { method: 'PATCH', body }))
    emit('changed')
  }
  catch (err) { showError(err, t('bots.updateFailed')) }
}

async function rename(bot: BoardBot) {
  const value = (await ask({ title: t('bots.rename'), label: t('common.name'), initial: bot.name, maxlength: 100 }))?.trim()
  if (value && value !== bot.name) await patch(bot, { name: value })
}

async function remove(bot: BoardBot) {
  if (!await confirm({ title: t('bots.deleteConfirm', { name: bot.name }), description: t('bots.deleteDescription'), confirmLabel: t('common.delete'), color: 'error' })) return
  try {
    await api(`/api/bots/${bot.id}`, { method: 'DELETE' })
    list.value = list.value.filter(b => b.id !== bot.id)
    emit('changed')
  }
  catch (err) { showError(err, t('bots.deleteFailed')) }
}

// Profile picture: cropped and scaled down in the browser like on /account.
const overlay = useOverlay()
const toast = useToast()
const pictureInput = useTemplateRef<HTMLInputElement>('pictureInput')
const pictureBot = ref<BoardBot | null>(null)
const savingPicture = ref<string | null>(null)

function pickPicture(bot: BoardBot) {
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
    replace(await api<BoardBot>(`/api/bots/${bot.id}/avatar`, { method: 'POST', body: form }))
    emit('changed')
  }
  catch (err) { showError(err, t('account.profile.pictureFailed')) }
  finally { savingPicture.value = null }
}

async function removePicture(bot: BoardBot) {
  savingPicture.value = bot.id
  try {
    replace(await api<BoardBot>(`/api/bots/${bot.id}/avatar`, { method: 'DELETE' }))
    emit('changed')
  }
  catch (err) { showError(err, t('account.profile.pictureRemoveFailed')) }
  finally { savingPicture.value = null }
}

const pictureItems = (bot: BoardBot) => [
  { label: bot.avatarUrl ? t('account.profile.pictureChange') : t('account.profile.pictureUpload'), icon: 'i-lucide-image-up', onSelect: () => pickPicture(bot) },
  ...bot.avatarUrl ? [{ label: t('account.profile.pictureRemove'), icon: 'i-lucide-trash-2', onSelect: () => removePicture(bot) }] : [],
]

// New token dialog
const tokenBot = ref<BoardBot | null>(null)
const tokenOpen = ref(false)
const tokenName = ref('')
const access = ref<'read' | 'write'>('write')
const expiry = ref<'30' | '90' | '365' | 'never'>('never')
const creating = ref(false)
/** The new token, shown once. */
const created = ref<string | null>(null)

const accessItems = computed(() => [
  { label: t('tokens.readOnly'), value: 'read', description: t(team.value ? 'bots.team.readOnlyDescription' : 'bots.readOnlyDescription') },
  { label: t('tokens.readWrite'), value: 'write', description: t(team.value ? 'bots.team.readWriteDescription' : 'bots.readWriteDescription') },
])
const expiryItems = computed(() => [
  { label: t('tokens.days30'), value: '30' },
  { label: t('tokens.days90'), value: '90' },
  { label: t('tokens.year'), value: '365' },
  { label: t('tokens.never'), value: 'never' },
])

function openToken(bot: BoardBot) {
  tokenBot.value = bot
  tokenName.value = ''
  access.value = bot.role === 'editor' ? 'write' : 'read'
  expiry.value = 'never'
  created.value = null
  tokenOpen.value = true
}

async function createToken() {
  const bot = tokenBot.value
  if (!bot || !tokenName.value.trim()) return
  creating.value = true
  try {
    const { token, ...meta } = await api<BotToken & { token: string }>(`/api/bots/${bot.id}/tokens`, {
      method: 'POST',
      body: {
        name: tokenName.value.trim(),
        scopes: access.value === 'write' ? ['read', 'write'] : ['read'],
        expiresInDays: expiry.value === 'never' ? null : Number(expiry.value),
      },
    })
    const current = list.value.find(b => b.id === bot.id)
    if (current) replace({ ...current, tokens: [meta, ...current.tokens ?? []] })
    created.value = token
  }
  catch (err) { showError(err, t('tokens.createFailed')) }
  finally { creating.value = false }
}

async function revoke(bot: BoardBot, token: BotToken) {
  if (!await confirm({ title: t('bots.revokeConfirm', { name: token.name }), confirmLabel: t('tokens.revoke'), color: 'error' })) return
  try {
    await api(`/api/bots/${bot.id}/tokens/${token.id}`, { method: 'DELETE' })
    const current = list.value.find(b => b.id === bot.id)
    if (current) replace({ ...current, tokens: (current.tokens ?? []).filter(tk => tk.id !== token.id) })
  }
  catch (err) { showError(err, t('tokens.revokeFailed')) }
}
</script>

<template>
  <USlideover v-model:open="open" :title="t('bots.title')" :description="t(team ? 'bots.team.description' : 'bots.description')">
    <template #body>
      <form class="flex flex-col gap-2 mb-6" data-testid="add-bot" @submit.prevent="add">
        <UInput v-model="name" :placeholder="t('bots.namePlaceholder')" :aria-label="t('common.name')" icon="i-lucide-bot" maxlength="100" class="w-full" />
        <div class="flex gap-2">
          <USelect v-model="role" :items="roles" :aria-label="t('bots.role')" class="flex-1" />
          <UButton type="submit" icon="i-lucide-plus" :label="t('bots.add')" :loading="adding" :disabled="!name.trim()" />
        </div>
      </form>

      <p v-if="!list.length" class="text-sm text-muted">
        {{ t('bots.empty') }}
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="bot in list" :key="bot.id" class="py-3 space-y-2" data-testid="bot">
          <div class="flex items-center gap-3">
            <UDropdownMenu :items="pictureItems(bot)">
              <button
                type="button"
                class="group relative shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                :aria-label="t('bots.picture', { name: bot.name })"
                :aria-busy="savingPicture === bot.id"
                :disabled="savingPicture === bot.id"
                data-testid="bot-picture"
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
            <USelect
              :model-value="bot.role"
              :items="roles"
              size="sm"
              class="w-28"
              :aria-label="t('bots.role')"
              @update:model-value="(r: BotRole) => patch(bot, { role: r })"
            />
            <MemberLimitButton
              :limited="!!props.limitedIds?.includes(bot.id)"
              :can-limit="!!props.canLimit"
              @limit="emit('limit', bot.id)"
            />
            <UTooltip :text="t('bots.rename')">
              <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-pencil" :aria-label="t('bots.rename')" @click="rename(bot)" />
            </UTooltip>
            <UTooltip :text="t('bots.delete')">
              <UButton color="error" variant="ghost" size="sm" icon="i-lucide-trash" :aria-label="t('bots.delete')" @click="remove(bot)" />
            </UTooltip>
          </div>
          <ul v-if="liveTokens(bot).length" class="ms-13 space-y-1">
            <li v-for="tk in liveTokens(bot)" :key="tk.id" class="flex items-center gap-2" data-testid="bot-token">
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
                </p>
              </div>
              <UButton color="neutral" variant="ghost" size="xs" :label="t('tokens.revoke')" @click="revoke(bot, tk)" />
            </li>
          </ul>
          <UButton class="ms-13" color="neutral" variant="outline" size="xs" icon="i-lucide-key-round" :label="t('tokens.new')" @click="openToken(bot)" />
        </li>
      </ul>

      <input ref="pictureInput" type="file" :accept="AVATAR_TYPES.join(',')" class="hidden" :aria-label="t('account.profile.picture')" @change="onPicture">

      <UModal v-model:open="tokenOpen" :title="created ? t('tokens.copyTitle') : t('bots.newTokenTitle', { name: tokenBot?.name ?? '' })">
        <template #body>
          <TokenCreatedPanel v-if="created" :token="created" :warning="t(team ? 'bots.team.onlyOnceDescription' : 'bots.onlyOnceDescription', { name: tokenBot?.name ?? '' })" />
          <form v-else id="new-bot-token" class="space-y-4" @submit.prevent="createToken">
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
              <UButton type="submit" form="new-bot-token" :label="t('tokens.create')" :loading="creating" :disabled="!tokenName.trim()" />
            </template>
          </div>
        </template>
      </UModal>
    </template>
  </USlideover>
</template>
