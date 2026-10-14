/**
 * Service worker caches that hold one user's data (runtimeCaching in nuxt.config.ts):
 * API responses and server-rendered pages. Static assets and icons are shared.
 */
export const userCacheNames = ['kanso-api', 'kanso-pages'] as const

/** localStorage key: the user the user caches were filled for. */
export const cacheOwnerKey = 'kanso:cache-owner'

type OwnerStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Deletes the per-user caches (no-op where CacheStorage is unavailable, e.g. plain http). */
export async function clearUserCaches(storage: Pick<CacheStorage, 'delete'> | undefined = globalThis.caches) {
  if (!storage) return
  await Promise.all(userCacheNames.map(name => storage.delete(name)))
}

/**
 * Keeps the per-user caches to the signed-in user, so a shared device never shows
 * offline data of whoever used it before. Clears them when the user differs from
 * the one they were filled for, and always while signed out (a response cached
 * just before sign-out may land after the first clear). Returns whether it cleared.
 */
export async function syncCacheOwner(
  userId: string | null | undefined,
  store: OwnerStore = localStorage,
  storage: Pick<CacheStorage, 'delete'> | undefined = globalThis.caches,
) {
  const owner = store.getItem(cacheOwnerKey)
  if (userId && owner === userId) return false
  await clearUserCaches(storage)
  if (userId) store.setItem(cacheOwnerKey, userId)
  else store.removeItem(cacheOwnerKey)
  return true
}
