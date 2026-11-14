<script setup lang="ts">
import type { BoardMatrixRoom } from '#shared/types/matrix'
import type { ActivityKind } from '#shared/types/board'
import { webhookEvents } from '#shared/webhooks'

const props = defineProps<{ boardId: string, room: BoardMatrixRoom | null }>()
const emit = defineEmits<{ 'update:room': [room: BoardMatrixRoom | null] }>()
const open = defineModel<boolean>('open', { required: true })
const showError = useApiError()
const toast = useToast()
const { t } = useI18n()
const confirm = useConfirm()

/** The connect / change form; shown at once when no room is connected. */
const editing = ref(false)
const homeserver = ref('')
const roomInput = ref('')
const accessToken = ref('')
const saving = ref(false)
const testing = ref(false)

function startEdit() {
  homeserver.value = props.room?.homeserverUrl ?? ''
  roomInput.value = props.room?.roomId ?? ''
  accessToken.value = ''
  editing.value = true
}
watch(open, (isOpen) => {
  if (isOpen && !props.room) startEdit()
  if (!isOpen) editing.value = false
}, { immediate: true })

async function save() {
  saving.value = true
  try {
    const room = await api<BoardMatrixRoom>(`/api/boards/${props.boardId}/matrix`, {
      method: 'PUT',
      body: { homeserver: homeserver.value.trim(), room: roomInput.value.trim(), ...(accessToken.value.trim() && { accessToken: accessToken.value.trim() }) },
    })
    emit('update:room', room)
    editing.value = false
    accessToken.value = ''
    toast.add({ title: t('matrix.connected', { room: room.roomName ?? room.roomId }), color: 'success' })
  }
  catch (err) { showError(err, t('matrix.saveFailed')) }
  finally { saving.value = false }
}

async function test() {
  testing.value = true
  try {
    const room = await api<BoardMatrixRoom>(`/api/boards/${props.boardId}/matrix/test`, { method: 'POST' })
    emit('update:room', room)
    toast.add({ title: t('matrix.testOk'), color: 'success' })
  }
  catch (err) { showError(err, t('matrix.testFailed')) }
  finally { testing.value = false }
}

async function disconnect() {
  if (!await confirm({ title: t('matrix.disconnectConfirm'), confirmLabel: t('matrix.disconnect') })) return
  try {
    await api(`/api/boards/${props.boardId}/matrix`, { method: 'DELETE' })
    emit('update:room', null)
    startEdit()
  }
  catch (err) { showError(err, t('matrix.disconnectFailed')) }
}

/** Card activity in threads: saved as soon as it changes. */
const activitySaving = ref(false)
const eventItems = computed(() => webhookEvents.map(k => ({ label: t(`webhooks.eventLabels.${k}`), value: k })))
// Turning it on starts with everything but comments, which the Matrix tab shows already.
const defaultEvents = webhookEvents.filter(k => k !== 'commented' && k !== 'mentioned')

async function saveActivity(patch: { postActivity?: boolean, activityEvents?: string[] }) {
  if (!props.room) return
  activitySaving.value = true
  try {
    emit('update:room', await api<BoardMatrixRoom>(`/api/boards/${props.boardId}/matrix`, { method: 'PATCH', body: patch }))
  }
  catch (err) { showError(err, t('matrix.activity.saveFailed')) }
  finally { activitySaving.value = false }
}

function setPostActivity(on: boolean) {
  saveActivity(on && !props.room?.activityEvents.length ? { postActivity: true, activityEvents: defaultEvents } : { postActivity: on })
}

const allEvents = computed(() => !props.room?.activityEvents.length)
function setAllEvents(all: boolean) {
  saveActivity({ activityEvents: all ? [] : defaultEvents })
}
function setEvents(events: string[]) {
  if (events.length) saveActivity({ activityEvents: events })
}

const matrixToLink = computed(() => props.room ? `https://matrix.to/#/${encodeURIComponent(props.room.roomId)}` : null)
</script>

<template>
  <USlideover v-model:open="open" :title="t('matrix.title')" :description="t('matrix.description')">
    <template #body>
      <div class="space-y-4">
        <div v-if="room && !editing" class="space-y-3 rounded-md border border-default p-3">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-message-square-share" class="size-5 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ room.roomName ?? room.roomId }}
              </p>
              <p class="truncate text-xs text-muted">
                {{ room.roomId }}
              </p>
            </div>
            <UButton
              v-if="matrixToLink"
              :to="matrixToLink"
              target="_blank"
              rel="noopener"
              external
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-external-link"
              :aria-label="t('matrix.openRoom')"
            />
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt class="text-muted">
              {{ t('matrix.bot') }}
            </dt>
            <dd class="truncate">
              {{ room.botUserId }}
            </dd>
            <dt class="text-muted">
              {{ t('matrix.homeserver') }}
            </dt>
            <dd class="truncate">
              {{ room.homeserverUrl }}
            </dd>
          </dl>
          <div class="flex flex-wrap gap-1">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-plug-zap" :label="t('matrix.test')" :loading="testing" @click="test" />
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :label="t('matrix.change')" @click="startEdit" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-unplug" :label="t('matrix.disconnect')" @click="disconnect" />
          </div>
        </div>

        <div v-if="room && !editing" class="space-y-3 rounded-md border border-default p-3">
          <USwitch
            :model-value="room.postActivity"
            :label="t('matrix.activity.post')"
            :description="t('matrix.activity.postHelp')"
            :disabled="activitySaving"
            @update:model-value="setPostActivity"
          />
          <template v-if="room.postActivity">
            <USwitch :model-value="allEvents" :label="t('webhooks.allEvents')" :disabled="activitySaving" @update:model-value="setAllEvents" />
            <UCheckboxGroup
              v-if="!allEvents"
              :model-value="(room.activityEvents as ActivityKind[])"
              :items="eventItems"
              :disabled="activitySaving"
              class="grid grid-cols-2 gap-1"
              @update:model-value="setEvents($event as string[])"
            />
          </template>
        </div>

        <form v-else class="space-y-3" @submit.prevent="save">
          <UFormField :label="t('matrix.homeserver')" :help="t('matrix.homeserverHelp')">
            <UInput v-model="homeserver" class="w-full" placeholder="matrix.org" maxlength="300" required autofocus />
          </UFormField>
          <UFormField :label="t('matrix.room')" :help="t('matrix.roomHelp')">
            <UInput v-model="roomInput" class="w-full font-mono" placeholder="#team:example.org" maxlength="300" required />
          </UFormField>
          <UFormField :label="t('matrix.token')" :help="room ? t('matrix.tokenKeep') : t('matrix.tokenHelp')">
            <UInput v-model="accessToken" type="password" class="w-full font-mono" autocomplete="off" maxlength="2000" :required="!room" />
          </UFormField>
          <UAlert color="neutral" variant="subtle" icon="i-lucide-info" :description="t('matrix.botHint')" />
          <div class="flex justify-end gap-2">
            <UButton v-if="room" color="neutral" variant="ghost" :label="t('common.cancel')" @click="editing = false" />
            <UButton type="submit" :label="t('matrix.connect')" :loading="saving" :disabled="!homeserver.trim() || !roomInput.trim() || (!room && !accessToken.trim())" />
          </div>
        </form>
      </div>
    </template>
  </USlideover>
</template>
