<script setup lang="ts">
import type { ActivityKind } from '#shared/types/board'
import type { BoardWebhook, WebhookTestResult } from '#shared/types/webhooks'
import { webhookEvents, type WebhookFormat } from '#shared/webhooks'

const props = defineProps<{ boardId: string }>()
const open = defineModel<boolean>('open', { required: true })
const showError = useApiError()
const toast = useToast()
const { t, locale } = useI18n()
const confirm = useConfirm()

const hooks = ref<BoardWebhook[] | null>(null)

async function load() {
  try {
    hooks.value = await api<BoardWebhook[]>(`/api/boards/${props.boardId}/webhooks`)
  }
  catch (err) { showError(err, t('webhooks.loadFailed')) }
}
watch(open, (isOpen) => { if (isOpen) load() }, { immediate: true })

const formatItems = computed(() => [
  { label: t('webhooks.jsonSigned'), value: 'json' },
  { label: 'Slack', value: 'slack' },
  { label: 'Discord', value: 'discord' },
])
const formatLabel: Record<WebhookFormat, string> = { json: 'JSON', slack: 'Slack', discord: 'Discord' }

const eventLabel = (k: string) => (webhookEvents as string[]).includes(k) ? t(`webhooks.eventLabels.${k}`) : k
const eventItems = computed(() => webhookEvents.map(k => ({ label: eventLabel(k), value: k })))

/** The add / edit form; editingId null = adding. */
const formOpen = ref(false)
const editingId = ref<string | null>(null)
const url = ref('')
const format = ref<WebhookFormat>('json')
const allEvents = ref(true)
const events = ref<ActivityKind[]>([])
const saving = ref(false)
/** Signing secret of the webhook just added (json only), shown once. */
const newSecret = ref<string | null>(null)

function startAdd() {
  editingId.value = null
  url.value = ''
  format.value = 'json'
  allEvents.value = true
  events.value = []
  newSecret.value = null
  formOpen.value = true
}

function startEdit(h: BoardWebhook) {
  editingId.value = h.id
  url.value = h.url
  format.value = h.format
  allEvents.value = !h.events.length
  events.value = h.events as ActivityKind[]
  newSecret.value = null
  formOpen.value = true
}

async function save() {
  saving.value = true
  const body = { url: url.value.trim(), format: format.value, events: allEvents.value ? [] : events.value }
  try {
    if (editingId.value) {
      const updated = await api<BoardWebhook>(`/api/webhooks/${editingId.value}`, { method: 'PATCH', body })
      hooks.value = hooks.value?.map(h => h.id === updated.id ? updated : h) ?? null
    }
    else {
      const { secret, ...created } = await api<BoardWebhook & { secret: string }>(`/api/boards/${props.boardId}/webhooks`, { method: 'POST', body })
      hooks.value = [...hooks.value ?? [], created]
      if (created.format === 'json') newSecret.value = secret
    }
    formOpen.value = false
  }
  catch (err) { showError(err, t('webhooks.saveFailed')) }
  finally { saving.value = false }
}

async function setActive(h: BoardWebhook, active: boolean) {
  const before = h.active
  h.active = active
  try {
    Object.assign(h, await api<BoardWebhook>(`/api/webhooks/${h.id}`, { method: 'PATCH', body: { active } }))
  }
  catch (err) {
    h.active = before
    showError(err, t('webhooks.updateFailed'))
  }
}

async function remove(h: BoardWebhook) {
  if (!await confirm({ title: t('webhooks.deleteConfirm', { url: h.url }), confirmLabel: t('common.delete') })) return
  hooks.value = hooks.value?.filter(x => x.id !== h.id) ?? null
  try {
    await api(`/api/webhooks/${h.id}`, { method: 'DELETE' })
  }
  catch (err) {
    showError(err, t('webhooks.deleteFailed'))
    await load()
  }
}

const testing = ref<string | null>(null)
async function test(h: BoardWebhook) {
  testing.value = h.id
  try {
    const res = await api<WebhookTestResult>(`/api/webhooks/${h.id}/test`, { method: 'POST' })
    toast.add(res.ok
      ? { title: t('webhooks.testDelivered', { status: res.status }), color: 'success' }
      : { title: t('webhooks.testFailed'), description: res.error ?? undefined, color: 'error' })
    await load()
  }
  catch (err) { showError(err, t('webhooks.testError')) }
  finally { testing.value = null }
}

async function copySecret() {
  if (!newSecret.value) return
  await navigator.clipboard.writeText(newSecret.value)
  toast.add({ title: t('webhooks.secretCopied'), color: 'success' })
}

function eventsSummary(h: BoardWebhook) {
  if (!h.events.length) return t('webhooks.allEvents')
  return h.events.map(eventLabel).join(', ')
}
</script>

<template>
  <USlideover v-model:open="open" :title="t('webhooks.title')" :description="t('webhooks.description')">
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="newSecret"
          color="warning"
          variant="subtle"
          icon="i-lucide-key-round"
          :title="t('webhooks.secretTitle')"
          :description="t('webhooks.secretDescription')"
          :close="true"
          @update:open="newSecret = null"
        >
          <template #actions>
            <UInput :model-value="newSecret" readonly size="sm" class="w-full font-mono">
              <template #trailing>
                <UTooltip :text="t('webhooks.copySecret')">
                  <UButton color="neutral" variant="link" size="sm" icon="i-lucide-copy" :aria-label="t('webhooks.copySecret')" @click="copySecret" />
                </UTooltip>
              </template>
            </UInput>
          </template>
        </UAlert>

        <form v-if="formOpen" class="space-y-3 rounded-md border border-default p-3" @submit.prevent="save">
          <UFormField :label="t('webhooks.url')">
            <UInput v-model="url" type="url" class="w-full" placeholder="https://hooks.slack.com/services/…" maxlength="2000" required autofocus />
          </UFormField>
          <UFormField :label="t('webhooks.format')">
            <USelect v-model="format" :items="formatItems" class="w-48" />
          </UFormField>
          <UFormField :label="t('webhooks.events')">
            <USwitch v-model="allEvents" :label="t('webhooks.allEvents')" />
            <UCheckboxGroup v-if="!allEvents" v-model="events" :items="eventItems" class="mt-2 grid grid-cols-2 gap-1" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="formOpen = false" />
            <UButton type="submit" :label="editingId ? t('common.save') : t('webhooks.add')" :loading="saving" :disabled="!url.trim() || (!allEvents && !events.length)" />
          </div>
        </form>
        <UButton v-else icon="i-lucide-plus" :label="t('webhooks.add')" color="neutral" variant="outline" @click="startAdd" />

        <USkeleton v-if="!hooks" class="h-16 w-full" />
        <p v-else-if="!hooks.length" class="text-sm text-muted">
          {{ t('webhooks.empty') }}
        </p>
        <ul v-else class="divide-y divide-default">
          <li v-for="h in hooks" :key="h.id" class="py-3 space-y-1">
            <div class="flex items-center gap-2">
              <USwitch :model-value="h.active" :aria-label="h.active ? t('webhooks.turnOff') : t('webhooks.turnOn')" @update:model-value="setActive(h, $event)" />
              <UTooltip :text="h.url">
                <p class="flex-1 min-w-0 truncate text-sm font-medium">
                  {{ h.url }}
                </p>
              </UTooltip>
              <UBadge color="neutral" variant="subtle" size="sm" :label="formatLabel[h.format]" />
            </div>
            <p class="text-xs text-muted">
              {{ eventsSummary(h) }}
            </p>
            <p v-if="h.lastDeliveryAt" class="text-xs" :class="h.lastError ? 'text-error' : 'text-muted'">
              {{ t('webhooks.lastDelivery', { date: formatDateTime(h.lastDeliveryAt, locale) }) }}
              {{ h.lastError ?? t('webhooks.httpStatus', { status: h.lastStatus }) }}
              <template v-if="h.failureCount">
                · {{ t('webhooks.failures', {}, h.failureCount) }}
              </template>
            </p>
            <p v-if="!h.active && h.failureCount >= 20" class="text-xs text-error">
              {{ t('webhooks.disabled') }}
            </p>
            <div class="flex gap-1">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-send" :label="t('webhooks.test')" :loading="testing === h.id" @click="test(h)" />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :label="t('common.edit')" @click="startEdit(h)" />
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash" :label="t('common.delete')" @click="remove(h)" />
            </div>
          </li>
        </ul>
      </div>
    </template>
  </USlideover>
</template>
