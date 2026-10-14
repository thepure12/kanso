import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import CardFields from '~/components/CardFields.vue'
import type { BoardField } from '#shared/types/board'

const fields: BoardField[] = [
  { id: 'n', name: 'Amount', kind: 'number', options: [], position: 1, showOnCard: false },
  { id: 'u', name: 'Site', kind: 'url', options: [], position: 2, showOnCard: false },
  { id: 's', name: 'Size', kind: 'select', options: [{ id: 'l', label: 'Large', color: '#ef4444' }], position: 3, showOnCard: false },
]

describe('CardFields', () => {
  it('saves valid input, clears empty input and flags invalid links', async () => {
    const w = await mountSuspended(CardFields, { props: { fields, values: { n: 3 }, canEdit: true } })
    const [amount, site] = w.findAll('input')
    await amount!.setValue('')
    await site!.setValue('https://example.com')
    await site!.setValue('ftp://example.com')
    expect(w.emitted('set')!.map(([f, v]) => [(f as BoardField).id, v])).toEqual([['n', null], ['u', 'https://example.com']])
    expect(w.text()).toContain('http:// or https://')
  })

  it('shows values read-only to viewers', async () => {
    const w = await mountSuspended(CardFields, { props: { fields, values: { s: 'l', u: 'https://example.com' }, canEdit: false } })
    expect(w.find('input').exists()).toBe(false)
    expect(w.text()).toContain('Large')
    expect(w.find('a[href="https://example.com"]').exists()).toBe(true)
    expect(w.text()).toContain('None')
  })
})
