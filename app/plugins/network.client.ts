/** Tracks navigator.onLine in useOffline(), starting once the app has hydrated. */
export default defineNuxtPlugin((nuxtApp) => {
  const offline = useOffline()
  const update = () => { offline.value = !navigator.onLine }
  nuxtApp.hook('app:mounted', update)
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
})
