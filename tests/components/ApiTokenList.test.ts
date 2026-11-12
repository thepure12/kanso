import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ApiTokenList from '~/components/ApiTokenList.vue'
import type { ApiToken } from '#shared/types/account'

const base = { boards: null, createdAt: '2026-10-01T08:00:00Z', lastUsedAt: null, expiresAt: null, revokedAt: null }
const tokens: ApiToken[] = [
  { ...base, id: 't1', name: 'CI', prefix: 'kb_Ab12Cd3', scopes: ['read'], lastUsedAt: '2026-10-13T08:00:00Z' },
  { ...base, id: 't2', name: 'Sync', prefix: 'kb_Zz98Yy7', scopes: ['read', 'write'], boards: [{ id: 'b1', name: 'Roadmap' }, { id: 'b2', name: 'Ops' }] },
  { ...base, id: 't3', name: 'Old', prefix: 'kb_Rev0ked', scopes: ['read'], revokedAt: '2026-10-02T08:00:00Z' },
  { ...base, id: 't4', name: 'Expired', prefix: 'kb_Exp1red', scopes: ['read'], expiresAt: '2026-01-01T00:00:00Z' },
]
registerEndpoint('/api/account/tokens', () => tokens)

describe('ApiTokenList', () => {
  it('lists live tokens with their prefix, access and boards, hiding revoked and expired ones', async () => {
    const w = await mountSuspended(ApiTokenList)
    const items = w.findAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('CI')
    expect(items[0]!.text()).toContain('kb_Ab12Cd3')
    expect(items[0]!.text()).toContain('Read only')
    expect(items[1]!.text()).toContain('Read and write')
    expect(items[1]!.text()).toContain('Never used')
    expect(items[0]!.text()).not.toContain('Boards:')
    expect(items[1]!.text()).toContain('Boards: Roadmap, Ops')
    expect(w.text()).not.toContain('kb_Rev0ked')
    expect(w.text()).not.toContain('Expired')
  })
})
