<script setup lang="ts">
import { channelOn, notificationChannels, notificationEvents, withChannel, type NotificationChannel, type NotificationEvent, type NotificationPrefs } from '#shared/notificationSettings'

// Which events notify where (users.notification_prefs) and whether watched
// cards notify at all. Saved on each change; the parent refreshes the account.
const props = defineProps<{
  prefs: NotificationPrefs
  notifyWatching: boolean
  digestEnabled: boolean
}>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const showError = useApiError()

// Local copy so quick clicks build on each other before the refresh lands.
const local = ref<NotificationPrefs>(props.prefs)
watch(() => props.prefs, p => { local.value = p })

const channelLabel: Record<NotificationChannel, string> = {
  inbox: 'account.notifications.channelInbox',
  push: 'account.notifications.channelPush',
  email: 'account.notifications.channelEmail',
}

function disabled(event: NotificationEvent, channel: NotificationChannel) {
  if (channel === 'email' && !props.digestEnabled) return true
  return channel !== 'inbox' && !channelOn(local.value, event, 'inbox')
}

async function save(body: { notificationPrefs?: NotificationPrefs, notifyWatching?: boolean }) {
  try {
    await $fetch('/api/account', { method: 'PATCH', body })
  }
  catch (err) {
    local.value = props.prefs
    showError(err, t('account.settingFailed'))
  }
  emit('changed')
}

function toggle(event: NotificationEvent, channel: NotificationChannel, on: boolean) {
  local.value = withChannel(local.value, event, channel, on)
  save({ notificationPrefs: local.value })
}
</script>

<template>
  <section class="space-y-4">
    <div>
      <h2 class="text-lg font-medium">
        {{ t('account.notifications.whatNotifies') }}
      </h2>
      <p class="text-sm text-muted">
        {{ t('account.notifications.whatNotifiesDescription') }}
      </p>
    </div>
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-default text-muted">
          <th class="py-2 pe-2 text-start font-medium">
            {{ t('account.notifications.event') }}
          </th>
          <th v-for="c in notificationChannels" :key="c" class="w-16 px-1 py-2 text-center font-medium sm:w-24">
            {{ t(channelLabel[c]) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in notificationEvents" :key="e" class="border-b border-default last:border-0">
          <td class="py-2 pe-2">
            {{ t(`account.notifications.events.${e}`) }}
          </td>
          <td v-for="c in notificationChannels" :key="c" class="px-1 py-2">
            <div class="flex justify-center">
              <UCheckbox
                :model-value="channelOn(local, e, c)"
                :disabled="disabled(e, c)"
                :aria-label="`${t(`account.notifications.events.${e}`)}: ${t(channelLabel[c])}`"
                @update:model-value="v => toggle(e, c, v === true)"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!digestEnabled" class="text-xs text-muted">
      {{ t('account.notifications.emailNeedsDigest') }}
    </p>
    <USwitch
      :model-value="notifyWatching"
      :label="t('account.notifications.watching')"
      :description="t('account.notifications.watchingDescription')"
      @update:model-value="v => save({ notifyWatching: v })"
    />
    <p class="text-xs text-muted">
      {{ t('account.notifications.boardLevels') }}
    </p>
  </section>
</template>
