import { describe, expect, it } from 'vitest'
import { cacheOwnerKey, clearUserCaches, syncCacheOwner, userCacheNames } from '../../app/utils/pwaCache'

function fakes(owner?: string) {
  const items = new Map<string, string>(owner ? [[cacheOwnerKey, owner]] : [])
  const store = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => { items.set(k, v) },
    removeItem: (k: string) => { items.delete(k) },
  }
  const deleted: string[] = []
  const storage = { delete: async (name: string) => { deleted.push(name); return true } }
  return { items, store, storage, deleted }
}

describe('offline cache owner', () => {
  it('keeps the caches for the same user', async () => {
    const f = fakes('u1')
    expect(await syncCacheOwner('u1', f.store, f.storage)).toBe(false)
    expect(f.deleted).toEqual([])
  })

  it('clears them when another user signs in, and remembers the new one', async () => {
    const f = fakes('u1')
    expect(await syncCacheOwner('u2', f.store, f.storage)).toBe(true)
    expect(f.deleted.sort()).toEqual([...userCacheNames].sort())
    expect(f.items.get(cacheOwnerKey)).toBe('u2')
  })

  it('clears them for a first sign-in with no recorded owner', async () => {
    const f = fakes()
    expect(await syncCacheOwner('u1', f.store, f.storage)).toBe(true)
    expect(f.items.get(cacheOwnerKey)).toBe('u1')
  })

  it('clears them on sign-out and on every check while signed out', async () => {
    const f = fakes('u1')
    expect(await syncCacheOwner(null, f.store, f.storage)).toBe(true)
    expect(f.items.has(cacheOwnerKey)).toBe(false)
    f.deleted.length = 0
    expect(await syncCacheOwner(undefined, f.store, f.storage)).toBe(true)
    expect(f.deleted.length).toBe(userCacheNames.length)
  })

  it('leaves shared caches alone and tolerates a missing CacheStorage', async () => {
    const f = fakes()
    await clearUserCaches(f.storage)
    expect(f.deleted).not.toContain('kanso-icons')
    await expect(clearUserCaches(undefined)).resolves.toBeUndefined()
  })
})
