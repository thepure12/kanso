<script setup lang="ts">
import type { BoardMatrixRoom, MatrixUserLink } from '#shared/types/matrix'
import type { MatrixThreadApi } from '~/composables/useMatrixThread'

/** The reader's own Matrix account on the board: replies then start with a silent mention of it. */
const props = defineProps<{
  room: BoardMatrixRoom
  mt: MatrixThreadApi
}>()
const { t } = useI18n()
const showError = useApiError()
const toast = useToast()

const view = props.mt.view
const myLink = computed(() => view.value?.myLink ?? null)
const open = ref(false)
const mxidInput = ref('')
const busy = ref(false)

async function request(method: 'PUT' | 'POST' | 'DELETE', path: string, body?: Record<string, string>) {
  if (!view.value) return
  busy.value = true
  try {
    const res = await api<MatrixUserLink | { ok: true }>(`/api/boards/${view.value.boardId}/matrix/link${path}`, { method, body })
    if (view.value) view.value.myLink = 'mxid' in res ? res : null
    return res
  }
  catch (err) { showError(err, t('matrix.account.failed')) }
  finally { busy.value = false }
}

async function startLink() {
  if (!mxidInput.value.trim()) return
  if (await request('PUT', '', { mxid: mxidInput.value.trim() })) open.value = false
}

async function checkLink() {
  const res = await request('POST', '/check')
  if (res && 'verified' in res && res.verified) toast.add({ title: t('matrix.account.done', { mxid: res.mxid }), color: 'success' })
}

const unlink = () => request('DELETE', '')

const codeMessage = computed(() => myLink.value?.code ? `kanso-link ${myLink.value.code}` : '')
async function copyCode() {
  try {
    await navigator.clipboard.writeText(codeMessage.value)
    toast.add({ title: t('matrix.account.copied'), color: 'success' })
  }
  catch { /* clipboard refused: the code is on screen */ }
}

const roomLabel = computed(() => props.room.roomName ?? props.room.roomId)
</script>

<template>
  <div class="space-y-2 rounded-md border border-default p-2 text-xs">
    <div v-if="myLink?.verified" class="flex flex-wrap items-center gap-2">
      <UIcon name="i-lucide-user-check" class="size-4 shrink-0 text-primary" />
      <p class="min-w-0 flex-1 text-muted">
        {{ t('matrix.account.linked', { mxid: myLink.mxid }) }}
      </p>
      <UButton size="xs" color="neutral" variant="ghost" :label="t('matrix.account.unlink')" :loading="busy" @click="unlink" />
    </div>
    <template v-else-if="myLink?.code">
      <p class="text-muted">
        {{ t('matrix.account.pending', { room: roomLabel, mxid: myLink.mxid }) }}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <code class="rounded bg-elevated px-2 py-1 font-mono text-sm">{{ codeMessage }}</code>
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-copy" :aria-label="t('matrix.account.copy')" @click="copyCode" />
        <UButton size="xs" icon="i-lucide-check" :label="t('matrix.account.check')" :loading="busy" @click="checkLink" />
        <UButton size="xs" color="neutral" variant="ghost" :label="t('common.cancel')" :disabled="busy" @click="unlink" />
      </div>
    </template>
    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <p class="min-w-0 flex-1 text-muted">
          {{ t('matrix.account.help') }}
        </p>
        <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-link" :label="t('matrix.account.start')" @click="open = !open" />
      </div>
      <form v-if="open" class="flex gap-2" @submit.prevent="startLink">
        <UInput v-model="mxidInput" size="sm" class="flex-1 font-mono" placeholder="@you:example.org" maxlength="255" autofocus />
        <UButton type="submit" size="sm" :label="t('matrix.account.getCode')" :loading="busy" :disabled="!mxidInput.trim()" />
      </form>
    </template>
  </div>
</template>
