// Web Push handlers, pulled into the generated service worker through
// workbox.importScripts (nuxt.config.ts). Messages come from server/utils/push.ts:
// { title, body, tag, url, readUrl?, force? }; url and readUrl include the base path.
self.addEventListener('push', (event) => {
  let msg = {}
  try { msg = event.data ? event.data.json() : {} }
  catch { msg = { body: event.data ? event.data.text() : '' } }
  const icon = new URL('pwa-192x192.png', self.registration.scope).href
  event.waitUntil((async () => {
    // A focused Kanso tab already tells the user (toast, or its own system
    // notification when asked for; app/composables/useDesktopNotifications.ts).
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (!msg.force && windows.some(c => c.focused && c.visibilityState === 'visible' && c.url.startsWith(self.registration.scope))) return
    await self.registration.showNotification(msg.title || 'Kanso', {
      body: msg.body || '',
      // The same tag as the open tab's own notification, so a device shows it once.
      tag: msg.tag,
      icon,
      badge: icon,
      data: { url: msg.url || self.registration.scope, readUrl: msg.readUrl },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { url, readUrl } = event.notification.data || {}
  const target = new URL(url || self.registration.scope, self.location.origin).href
  event.waitUntil((async () => {
    if (readUrl) {
      fetch(readUrl, { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{"read":true}' })
        .catch(() => {})
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const own = windows.find(c => c.url.startsWith(self.registration.scope))
    if (own) {
      await own.focus()
      // The page opens it through the router (app/plugins/push.client.ts), without a reload.
      own.postMessage({ type: 'kanso:open', url: target })
      return
    }
    await self.clients.openWindow(target)
  })())
})
