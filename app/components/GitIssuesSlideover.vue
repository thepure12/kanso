<script setup lang="ts">
import type { BoardGitLink, GitSyncResult } from '#shared/types/gitLinks'
import type { GitCloseAction } from '#shared/gitIssues'
import { GIT_LABEL_MAX } from '#shared/gitIssues'

const props = defineProps<{ boardId: string, columns: { id: string, title: string }[] }>()
const open = defineModel<boolean>('open', { required: true })
const showError = useApiError()
const toast = useToast()
const { t, locale } = useI18n()
const confirm = useConfirm()

const links = ref<BoardGitLink[] | null>(null)

async function load() {
  try {
    links.value = await api<BoardGitLink[]>(`/api/boards/${props.boardId}/git-links`)
  }
  catch (err) { showError(err, t('gitIssues.loadFailed')) }
}
watch(open, (isOpen) => { if (isOpen) load() }, { immediate: true })

const columnItems = computed(() => props.columns.map(c => ({ label: c.title, value: c.id })))
const closeItems = computed(() => [
  { label: t('gitIssues.closeNone'), value: 'none' },
  { label: t('gitIssues.closeComplete'), value: 'complete' },
])
const columnTitle = (id: string) => props.columns.find(c => c.id === id)?.title ?? t('gitIssues.columnGone')

/** The add / edit form; editing null = adding. */
const formOpen = ref(false)
const editing = ref<BoardGitLink | null>(null)
const repo = ref('')
const columnId = ref('')
const label = ref('')
const closeAction = ref<GitCloseAction>('none')
const token = ref('')
const removeToken = ref(false)
const saving = ref(false)

function startAdd() {
  editing.value = null
  repo.value = ''
  columnId.value = props.columns[0]?.id ?? ''
  label.value = ''
  closeAction.value = 'none'
  token.value = ''
  removeToken.value = false
  formOpen.value = true
}

function startEdit(l: BoardGitLink) {
  editing.value = l
  repo.value = l.repo
  columnId.value = l.columnId
  label.value = l.label ?? ''
  closeAction.value = l.closeAction
  token.value = ''
  removeToken.value = false
  formOpen.value = true
}

function replace(updated: BoardGitLink) {
  links.value = links.value?.map(x => x.id === updated.id ? updated : x) ?? null
}

async function save() {
  saving.value = true
  try {
    if (editing.value) {
      const body = {
        columnId: columnId.value,
        label: label.value.trim() || null,
        closeAction: closeAction.value,
        ...(removeToken.value ? { token: null } : token.value.trim() ? { token: token.value.trim() } : {}),
      }
      replace(await api<BoardGitLink>(`/api/git-links/${editing.value.id}`, { method: 'PATCH', body }))
      formOpen.value = false
    }
    else {
      const created = await api<BoardGitLink>(`/api/boards/${props.boardId}/git-links`, {
        method: 'POST',
        body: { repo: repo.value.trim(), columnId: columnId.value, label: label.value.trim() || null, closeAction: closeAction.value, token: token.value.trim() || null },
      })
      links.value = [...links.value ?? [], created]
      formOpen.value = false
      await sync(created)
    }
  }
  catch (err) { showError(err, t('gitIssues.saveFailed')) }
  finally { saving.value = false }
}

async function setActive(l: BoardGitLink, active: boolean) {
  const before = l.active
  l.active = active
  try {
    replace(await api<BoardGitLink>(`/api/git-links/${l.id}`, { method: 'PATCH', body: { active } }))
  }
  catch (err) {
    l.active = before
    showError(err, t('gitIssues.updateFailed'))
  }
}

async function remove(l: BoardGitLink) {
  if (!await confirm({ title: t('gitIssues.deleteConfirm', { repo: l.repo }), confirmLabel: t('common.delete') })) return
  links.value = links.value?.filter(x => x.id !== l.id) ?? null
  try {
    await api(`/api/git-links/${l.id}`, { method: 'DELETE' })
  }
  catch (err) {
    showError(err, t('gitIssues.deleteFailed'))
    await load()
  }
}

const syncing = ref<string | null>(null)
async function sync(l: BoardGitLink) {
  syncing.value = l.id
  try {
    const res = await api<GitSyncResult>(`/api/git-links/${l.id}/sync`, { method: 'POST' })
    if (res.error) toast.add({ title: t('gitIssues.syncFailed'), description: res.error, color: 'error' })
    else {
      toast.add({
        title: t('gitIssues.synced', { count: res.imported }, res.imported),
        description: res.completed ? t('gitIssues.completed', { count: res.completed }, res.completed) : undefined,
        color: 'success',
      })
    }
    await load()
  }
  catch (err) { showError(err, t('gitIssues.syncFailed')) }
  finally { syncing.value = null }
}
</script>

<template>
  <USlideover v-model:open="open" :title="t('gitIssues.title')" :description="t('gitIssues.description')">
    <template #body>
      <div class="space-y-4">
        <form v-if="formOpen" class="space-y-3 rounded-md border border-default p-3" @submit.prevent="save">
          <UFormField :label="t('gitIssues.repo')" :hint="editing ? undefined : t('gitIssues.repoHint')">
            <UInput v-model="repo" class="w-full" placeholder="owner/name" maxlength="300" :disabled="!!editing" required autofocus />
          </UFormField>
          <UFormField :label="t('gitIssues.column')" :description="t('gitIssues.columnHint')">
            <USelect v-model="columnId" :items="columnItems" class="w-full" />
          </UFormField>
          <UFormField :label="t('gitIssues.label')" :description="t('gitIssues.labelHint')">
            <UInput v-model="label" class="w-full" :maxlength="GIT_LABEL_MAX" />
          </UFormField>
          <UFormField :label="t('gitIssues.closeAction')">
            <USelect v-model="closeAction" :items="closeItems" class="w-full" />
          </UFormField>
          <UFormField :label="t('gitIssues.token')" :description="t('gitIssues.tokenHint')">
            <UInput
              v-model="token"
              type="password"
              autocomplete="off"
              class="w-full font-mono"
              maxlength="500"
              :placeholder="editing?.hasToken ? t('gitIssues.tokenKeep') : 'github_pat_…'"
              :disabled="removeToken"
            />
            <UCheckbox v-if="editing?.hasToken" v-model="removeToken" :label="t('gitIssues.removeToken')" class="mt-2" />
          </UFormField>
          <p class="text-xs text-muted">
            {{ t('gitIssues.labelsNote') }}
          </p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="formOpen = false" />
            <UButton type="submit" :label="editing ? t('common.save') : t('gitIssues.add')" :loading="saving" :disabled="!repo.trim() || !columnId" />
          </div>
        </form>
        <UButton v-else icon="i-lucide-plus" :label="t('gitIssues.add')" color="neutral" variant="outline" :disabled="!columns.length" @click="startAdd" />

        <USkeleton v-if="!links" class="h-16 w-full" />
        <p v-else-if="!links.length" class="text-sm text-muted">
          {{ t('gitIssues.empty') }}
        </p>
        <ul v-else class="divide-y divide-default">
          <li v-for="l in links" :key="l.id" class="py-3 space-y-1">
            <div class="flex items-center gap-2">
              <USwitch :model-value="l.active" :aria-label="l.active ? t('gitIssues.turnOff') : t('gitIssues.turnOn')" @update:model-value="setActive(l, $event)" />
              <UIcon name="i-simple-icons-github" class="size-4 shrink-0" />
              <a :href="`https://github.com/${l.repo}/issues`" target="_blank" rel="noopener noreferrer" class="flex-1 min-w-0 truncate text-sm font-medium hover:underline">
                {{ l.repo }}
              </a>
              <UBadge color="neutral" variant="subtle" size="sm" icon="i-lucide-columns-3" :label="columnTitle(l.columnId)" />
            </div>
            <p class="text-xs text-muted">
              {{ l.hasToken ? t('gitIssues.hasToken') : t('gitIssues.noToken') }}
              <template v-if="l.label">
                · {{ t('gitIssues.labelSummary', { label: l.label }) }}
              </template>
              <template v-if="l.closeAction === 'complete'">
                · {{ t('gitIssues.closeSummary') }}
              </template>
            </p>
            <p class="text-xs" :class="l.lastError ? 'text-error' : 'text-muted'">
              {{ l.lastSyncedAt ? t('gitIssues.lastSync', { date: formatDateTime(l.lastSyncedAt, locale) }) : t('gitIssues.neverSynced') }}
              <template v-if="l.lastError">
                · {{ l.lastError }}
              </template>
            </p>
            <div class="flex gap-1">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :label="t('gitIssues.syncNow')" :loading="syncing === l.id" :disabled="!l.active" @click="sync(l)" />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :label="t('common.edit')" @click="startEdit(l)" />
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash" :label="t('common.delete')" @click="remove(l)" />
            </div>
          </li>
        </ul>
      </div>
    </template>
  </USlideover>
</template>
