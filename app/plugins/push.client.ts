/**
 * Keeps this browser's push subscription in step with the session
 * (usePushNotifications().sync: renewed on sign-in, dropped on sign-out or when
 * someone else signs in), and opens the card when a push notification is
 * clicked while a Kanso tab is open (message from public/push-sw.js).
 */
export default defineNuxtPlugin((nuxtApp) => {
  if (!pushSupported()) return
  const { user } = useUserSession()
  const push = usePushNotifications()
  const router = useRouter()
  const base = basePath()

  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: string, url?: string }>) => {
    if (event.data?.type !== 'kanso:open' || !event.data.url) return
    const path = pushTargetPath(event.data.url, location.origin, base)
    if (path) router.push(path)
  })

  nuxtApp.hook('app:mounted', () => {
    watch(() => user.value?.id ?? null, () => {
      push.sync().catch(err => console.warn('Could not update push notifications', err))
    }, { immediate: true })
  })
})
