import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import SessionList from '~/components/SessionList.vue'
import type { AccountSession } from '#shared/types/account'

const sessions: AccountSession[] = [
  { id: 's1', current: true, ip: '10.0.0.1', createdAt: '2026-10-01T08:00:00Z', lastSeenAt: '2026-10-14T08:00:00Z', userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0' },
  { id: 's2', current: false, ip: '10.0.0.2', createdAt: '2026-10-02T08:00:00Z', lastSeenAt: '2026-10-13T08:00:00Z', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1' },
]
registerEndpoint('/api/account/sessions', () => sessions)

describe('SessionList', () => {
  it('names devices, marks this one and offers to sign out the others', async () => {
    const w = await mountSuspended(SessionList)
    const items = w.findAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('Firefox on Linux')
    expect(items[0]!.text()).toContain('This device')
    expect(items[1]!.text()).toContain('Safari on iOS')
    expect(items[1]!.text()).not.toContain('This device')
    expect(items[1]!.text()).toContain('10.0.0.2')
    expect(w.text()).toContain('Sign out all other sessions')
  })
})
