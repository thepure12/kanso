import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import OfflineBanner from '~/components/OfflineBanner.vue'

describe('OfflineBanner', () => {
  afterEach(() => { useOffline().value = false })

  it('shows only while offline', async () => {
    const w = await mountSuspended(OfflineBanner)
    expect(w.text()).not.toContain("You're offline")
    useOffline().value = true
    await nextTick()
    expect(w.text()).toContain("You're offline")
    expect(w.text()).toContain('Changes are disabled')
  })

  it('follows the browser online and offline events', async () => {
    const w = await mountSuspended(OfflineBanner)
    const onLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')
    try {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
      await nextTick()
      expect(w.text()).toContain("You're offline")
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      window.dispatchEvent(new Event('online'))
      await nextTick()
      expect(w.text()).not.toContain("You're offline")
    }
    finally {
      delete (navigator as { onLine?: boolean }).onLine
      if (onLine) Object.defineProperty(Navigator.prototype, 'onLine', onLine)
    }
  })
})
