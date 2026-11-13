import type { PushSettings } from '#shared/types/account'

type PushState = 'unsupported' | 'denied' | 'off' | 'on'

/** The service worker's registration, or null when there is none (dev builds) within a few seconds. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  if (reg?.active) return reg
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(() => r(null), 5000))])
}

/**
 * Web Push for this browser: notifications arrive even when no Kanso tab is
 * open (server/utils/push.ts, public/push-sw.js). The subscription belongs to
 * the user who turned it on (pushOwnerKey) and to their sign-in session.
 */
export function usePushNotifications() {
  const state = useState<PushState>('push-state', () => 'off')
  const endpoint = useState<string | null>('push-endpoint', () => null)
  const { user } = useUserSession()

  async function settings() {
    return await $fetch<PushSettings>('/api/account/push')
  }

  async function save(sub: PushSubscription) {
    await $fetch('/api/account/push', { method: 'POST', body: sub.toJSON() })
  }

  /**
   * Brings the browser and the server in line: drops a subscription that belongs
   * to someone else, renews one made with an old server key, and re-saves it (a
   * new sign-in session after signing in again). Called after mount and on
   * session changes (app/plugins/push.client.ts) and by the account page.
   */
  async function sync() {
    if (!pushSupported()) {
      state.value = 'unsupported'
      return
    }
    const reg = await registration()
    if (!reg) {
      state.value = 'unsupported'
      return
    }
    let sub = await reg.pushManager.getSubscription()
    const me = user.value?.id ?? null
    const owner = loadPushOwner()
    // Signed out, or someone else signed in: their subscription goes.
    if (owner && owner !== me) {
      if (sub) await sub.unsubscribe().catch(() => {})
      sub = null
      savePushOwner(null)
    }
    if (Notification.permission === 'denied') {
      state.value = 'denied'
      endpoint.value = null
      return
    }
    if (!me || loadPushOwner() !== me || Notification.permission !== 'granted') {
      state.value = 'off'
      endpoint.value = null
      return
    }
    const { publicKey } = await settings()
    if (sub && !sameServerKey(sub.options.applicationServerKey, publicKey)) {
      await sub.unsubscribe().catch(() => {})
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) })
    await save(sub)
    endpoint.value = sub.endpoint
    state.value = 'on'
  }

  /** Turning it on asks for permission; returns false when the browser refuses. */
  async function setEnabled(on: boolean): Promise<boolean> {
    if (!pushSupported()) return false
    const reg = await registration()
    if (!reg) return false
    if (!on) {
      const sub = await reg.pushManager.getSubscription()
      savePushOwner(null)
      if (sub) {
        await $fetch('/api/account/push', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      endpoint.value = null
      state.value = 'off'
      return true
    }
    if (Notification.permission === 'default') await Notification.requestPermission()
    if (Notification.permission !== 'granted') {
      state.value = Notification.permission === 'denied' ? 'denied' : 'off'
      return false
    }
    savePushOwner(user.value?.id ?? null)
    await sync()
    return state.value === 'on'
  }

  async function test() {
    return await $fetch<{ sent: number, total: number }>('/api/account/push/test', { method: 'POST', body: { endpoint: endpoint.value } })
  }

  return { state, endpoint, sync, setEnabled, test, settings }
}
