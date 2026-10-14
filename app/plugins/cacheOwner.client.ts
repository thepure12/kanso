/**
 * Clears the service worker's per-user caches (app/utils/pwaCache.ts) on sign-out
 * and whenever the session belongs to someone else than the cached data. Starts
 * after mounting, once the session is known (a clear on a not-yet-loaded session
 * would wipe the offline copy).
 */
export default defineNuxtPlugin((nuxtApp) => {
  const { user } = useUserSession()
  nuxtApp.hook('app:mounted', () => {
    watch(() => user.value?.id ?? null, (id) => {
      syncCacheOwner(id).catch(err => console.warn('Could not clear offline caches', err))
    }, { immediate: true })
  })
})
