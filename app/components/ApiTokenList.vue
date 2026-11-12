<script setup lang="ts">
import type { ApiToken } from '#shared/types/account'
import type { BoardSummary } from '#shared/types/board'

const showError = useApiError()
const toast = useToast()
const { t, locale } = useI18n()

const { data: tokens, refresh } = await useFetch<ApiToken[]>('/api/account/tokens', { default: () => [] })
const live = computed(() => tokens.value.filter(tk => !tk.revokedAt && !(tk.expiresAt && new Date(tk.expiresAt) <= new Date())))

const createOpen = ref(false)
const name = ref('')
const access = ref<'read' | 'write'>('read')
const expiry = ref<'30' | '90' | '365' | 'never'>('90')
const boardScope = ref<'all' | 'some'>('all')
const boardIds = ref<string[]>([])
const creating = ref(false)
/** The new token, shown once. */
const created = ref<string | null>(null)

const accessItems = computed(() => [
  { label: t('tokens.readOnly'), value: 'read', description: t('tokens.readOnlyDescription') },
  { label: t('tokens.readWrite'), value: 'write', description: t('tokens.readWriteDescription') },
])
const boardScopeItems = computed(() => [
  { label: t('tokens.allBoards'), value: 'all', description: t('tokens.allBoardsDescription') },
  { label: t('tokens.someBoards'), value: 'some', description: t('tokens.someBoardsDescription') },
])
/** Boards to pick from, loaded when the dialog first asks for them. */
const { data: boards, execute: loadBoards, status: boardsStatus } = useFetch<BoardSummary[]>('/api/boards', { immediate: false, server: false, default: () => [] })
const boardItems = computed(() => boards.value.map(b => ({ label: b.name, value: b.id })))
watch(boardScope, (scope) => {
  if (scope === 'some' && boardsStatus.value === 'idle') loadBoards()
})
const canCreate = computed(() => !!name.value.trim() && (boardScope.value === 'all' || boardIds.value.length > 0))

const expiryItems = computed(() => [
  { label: t('tokens.days30'), value: '30' },
  { label: t('tokens.days90'), value: '90' },
  { label: t('tokens.year'), value: '365' },
  { label: t('tokens.never'), value: 'never' },
])

function openCreate() {
  name.value = ''
  access.value = 'read'
  expiry.value = '90'
  boardScope.value = 'all'
  boardIds.value = []
  created.value = null
  createOpen.value = true
}

async function create() {
  creating.value = true
  try {
    const res = await $fetch<ApiToken & { token: string }>('/api/account/tokens', {
      method: 'POST',
      body: {
        name: name.value.trim(),
        scopes: access.value === 'write' ? ['read', 'write'] : ['read'],
        expiresInDays: expiry.value === 'never' ? null : Number(expiry.value),
        boardIds: boardScope.value === 'some' ? boardIds.value : null,
      },
    })
    created.value = res.token
    await refresh()
  }
  catch (err) { showError(err, t('tokens.createFailed')) }
  finally { creating.value = false }
}

async function copy() {
  if (!created.value) return
  await navigator.clipboard.writeText(created.value)
  toast.add({ title: t('tokens.copied'), color: 'success' })
}

/** MCP endpoint for AI agents, and the Claude Code command that adds it with the new token. */
const mcpUrl = computed(() => import.meta.client ? window.location.origin + appUrl('/api/mcp') : '')
const mcpCommand = computed(() => `claude mcp add --transport http kanso ${mcpUrl.value} --header "Authorization: Bearer ${created.value}"`)

async function copyMcpCommand() {
  await navigator.clipboard.writeText(mcpCommand.value)
  toast.add({ title: t('tokens.mcpCopied'), color: 'success' })
}

async function revoke(token: ApiToken) {
  try {
    await $fetch(`/api/account/tokens/${token.id}`, { method: 'DELETE' })
  }
  catch (err) { showError(err, t('tokens.revokeFailed')) }
  await refresh()
}

defineExpose({ refresh })
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-lg font-medium">
        {{ t('tokens.title') }}
      </h2>
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :label="t('tokens.new')" @click="openCreate" />
    </div>
    <i18n-t keypath="tokens.help" tag="p" class="text-sm text-muted" scope="global">
      <template #header>
        <code>Authorization: Bearer &lt;token&gt;</code>
      </template>
    </i18n-t>
    <ul v-if="live.length" class="divide-y divide-default">
      <li v-for="tk in live" :key="tk.id" class="flex items-center gap-3 py-3">
        <UIcon name="i-lucide-key-round" class="size-5 text-muted shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium">
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
          <UTooltip v-if="tk.boards" :text="tk.boards.map(b => b.name).join(', ')">
            <p class="text-xs text-muted truncate">
              {{ tk.boards.length ? t('tokens.limitedTo', { boards: tk.boards.map(b => b.name).join(', ') }) : t('tokens.noBoardsLeft') }}
            </p>
          </UTooltip>
        </div>
        <UButton color="neutral" variant="ghost" size="sm" :label="t('tokens.revoke')" @click="revoke(tk)" />
      </li>
    </ul>

    <UModal v-model:open="createOpen" :title="created ? t('tokens.copyTitle') : t('tokens.newTitle')">
      <template #body>
        <div v-if="created" class="space-y-3">
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="t('tokens.onlyOnce')"
            :description="t('tokens.onlyOnceDescription')"
          />
          <UInput :model-value="created" readonly class="w-full font-mono" @focus="($event.target as HTMLInputElement).select()">
            <template #trailing>
              <UTooltip :text="t('tokens.copy')">
                <UButton color="neutral" variant="link" size="sm" icon="i-lucide-copy" :aria-label="t('tokens.copy')" @click="copy" />
              </UTooltip>
            </template>
          </UInput>
          <div class="space-y-1">
            <p class="text-sm font-medium">
              {{ t('tokens.mcpTitle') }}
            </p>
            <i18n-t keypath="tokens.mcpHelp" tag="p" class="text-sm text-muted" scope="global">
              <template #url>
                <code class="break-all">{{ mcpUrl }}</code>
              </template>
            </i18n-t>
            <div class="flex items-start gap-1">
              <UTextarea :model-value="mcpCommand" readonly autoresize :rows="2" class="flex-1 font-mono text-xs" @focus="($event.target as HTMLTextAreaElement).select()" />
              <UTooltip :text="t('tokens.mcpCopy')">
                <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-copy" :aria-label="t('tokens.mcpCopy')" @click="copyMcpCommand" />
              </UTooltip>
            </div>
          </div>
        </div>
        <form v-else id="new-token" class="space-y-4" @submit.prevent="create">
          <UFormField :label="t('common.name')" :description="t('tokens.nameHelp')">
            <UInput v-model="name" class="w-full" maxlength="100" required autofocus />
          </UFormField>
          <UFormField :label="t('tokens.access')">
            <URadioGroup v-model="access" :items="accessItems" />
          </UFormField>
          <UFormField :label="t('tokens.boards')">
            <URadioGroup v-model="boardScope" :items="boardScopeItems" />
            <USelectMenu
              v-if="boardScope === 'some'"
              v-model="boardIds"
              :items="boardItems"
              value-key="value"
              multiple
              :loading="boardsStatus === 'pending'"
              :placeholder="t('tokens.pickBoards')"
              :aria-label="t('tokens.pickBoards')"
              class="w-full mt-2"
            />
          </UFormField>
          <UFormField :label="t('tokens.expiresLabel')">
            <USelect v-model="expiry" :items="expiryItems" class="w-40" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton v-if="created" :label="t('common.done')" @click="createOpen = false" />
          <template v-else>
            <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="createOpen = false" />
            <UButton type="submit" form="new-token" :label="t('tokens.create')" :loading="creating" :disabled="!canCreate" />
          </template>
        </div>
      </template>
    </UModal>
  </section>
</template>
