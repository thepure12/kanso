/**
 * The app's base path without a trailing slash ('' when served at the root, '/kanso'
 * for NUXT_APP_BASE_URL=/kanso/). $fetch, useFetch, api, NuxtLink and navigateTo add
 * it themselves; URLs that bypass them (EventSource, <img src>, <a href>, external
 * links, CSS url(), window.location) go through appUrl. Call it during setup or render
 * (it reads the runtime config); capture the value for later callbacks.
 */
export function basePath(): string {
  return useRuntimeConfig().app.baseURL.replace(/\/+$/, '')
}

/** An absolute app path ('/api/...') with the base path in front. */
export function appUrl(path: string): string {
  return basePath() + path
}
