import { describe, expect, it } from 'vitest'
import { describeActivity as describe_, describeNotification as notify } from '../../app/utils/activityText'
import { serverI18n } from '../../server/utils/i18n'

const en = serverI18n('en')
const describeActivity = (a: Parameters<typeof describe_>[0]) => describe_(a, en)
const describeNotification = (a: Parameters<typeof notify>[0], userId?: string) => notify(a, en, userId)

describe('activity text', () => {
  it('describes changes', () => {
    expect(describeActivity({ kind: 'moved', data: { from: 'Todo', to: 'Done' } })).toBe('moved this card from Todo to Done')
    expect(describeActivity({ kind: 'priority', data: { to: 'urgent' } })).toBe('set the priority to Urgent')
    expect(describeActivity({ kind: 'due', data: { to: null } })).toBe('removed the due date')
    expect(describeActivity({ kind: 'assigned', data: { user: 'Ana' } })).toBe('assigned Ana')
    expect(describeActivity({ kind: 'estimate', data: { to: '3.50' } })).toBe('set the estimate to 3.5 points')
    expect(describeActivity({ kind: 'estimate', data: { to: '1.00' } })).toBe('set the estimate to 1 point')
    expect(describeActivity({ kind: 'start', data: { to: null } })).toBe('removed the start date')
    expect(describeActivity({ kind: 'linked', data: { kind: 'blocks', direction: 'out', card: 'B' } })).toBe('marked this card as blocking "B"')
    expect(describeActivity({ kind: 'linked', data: { kind: 'blocks', direction: 'in', card: 'A' } })).toBe('marked this card as blocked by "A"')
    expect(describeActivity({ kind: 'linked', data: { kind: 'duplicates', direction: 'in', card: 'A' } })).toBe('marked "A" as a duplicate of this card')
    expect(describeActivity({ kind: 'linked', data: { kind: 'relates', direction: 'in', card: 'A' } })).toBe('linked this card to "A"')
    expect(describeActivity({ kind: 'unlinked', data: { kind: 'relates', direction: 'out', card: 'B' } })).toBe('removed the link to "B"')
  })

  it('addresses the recipient of an assignment', () => {
    expect(describeNotification({ kind: 'assigned', data: { user: 'Ana' } })).toBe('assigned you to this card')
    expect(describeNotification({ kind: 'commented', data: {} })).toBe('commented')
  })

  it('tells mentioned people they were mentioned', () => {
    const me = '0b5b6c1e-6f43-4d0e-9a51-7d1f1c3c2a10'
    const data = { mentions: [me] } as unknown as Record<string, string | null>
    expect(describeNotification({ kind: 'commented', data }, me)).toBe('mentioned you in a comment')
    expect(describeNotification({ kind: 'commented', data }, 'someone-else')).toBe('commented')
    expect(describeNotification({ kind: 'mentioned', data }, me)).toBe('mentioned you in a comment')
    expect(describeActivity({ kind: 'mentioned', data })).toBe('mentioned someone in a comment')
  })

  it('describes field changes', () => {
    const field = (kind: string, to: string | null) => describeActivity({ kind: 'field', data: { field: 'Size', kind, from: null, to } })
    expect(field('select', 'Large')).toBe('set Size to Large')
    expect(field('text', 'hi')).toBe('set Size to "hi"')
    expect(field('number', null)).toBe('cleared Size')
    expect(field('checkbox', 'true')).toBe('checked Size')
    expect(field('checkbox', 'false')).toBe('unchecked Size')
    expect(field('date', `${new Date().getFullYear()}-03-12`)).toMatch(/^set Size to .*12/)
  })
  it('speaks German', () => {
    const de = serverI18n('de')
    expect(describe_({ kind: 'moved', data: { from: 'Todo', to: 'Done' } }, de)).toBe('hat diese Karte von Todo nach Done verschoben')
    expect(describe_({ kind: 'estimate', data: { to: '3.50' } }, de)).toBe('hat die Schätzung auf 3,5 Punkte gesetzt')
    expect(describe_({ kind: 'estimate', data: { to: '1.00' } }, de)).toBe('hat die Schätzung auf 1 Punkt gesetzt')
    expect(describe_({ kind: 'priority', data: { to: 'urgent' } }, de)).toBe('hat die Priorität auf Dringend gesetzt')
    expect(notify({ kind: 'assigned', data: { user: 'Ana' } }, de)).toBe('hat dir diese Karte zugewiesen')
  })
})
