import { describe, expect, it } from 'vitest'
import { auditText as auditText_ } from '../../app/utils/auditText'
import { serverI18n } from '../../server/utils/i18n'
import type { AuditEntry } from '#shared/types/admin'

const auditText = (e: AuditEntry) => auditText_(e, serverI18n('en').t)

const entry = (action: string, data: Record<string, unknown>): AuditEntry =>
  ({ id: '1', action, actorId: null, targetUserId: null, data, createdAt: '2026-10-14T00:00:00Z' })
const people = { actor_name: 'Ada', actor_email: 'ada@x.org', target_name: 'Bob', target_email: 'bob@x.org' }

describe('auditText', () => {
  it('names actor and target from the stored data', () => {
    expect(auditText(entry('admin.promote', people))).toBe('Ada (ada@x.org) made Bob (bob@x.org) an admin')
    expect(auditText(entry('user.remove', people))).toBe('Ada (ada@x.org) removed the account Bob (bob@x.org)')
    expect(auditText(entry('user.delete_self', { target_name: 'Bob', target_email: 'bob@x.org' }))).toBe('Bob (bob@x.org) deleted their account')
    expect(auditText(entry('admin.demote', {}))).toBe('a deleted account removed admin rights from a deleted account')
  })

  it('lists changed settings', () => {
    const changes = { signup_mode: { from: 'restricted', to: 'open' }, allowed_domains: { from: [], to: ['x.org'] } }
    expect(auditText(entry('settings.update', { ...people, changes }))).toBe('Ada (ada@x.org) changed sign-up mode, allowed domains')
  })
  it('speaks German', () => {
    expect(auditText_(entry('admin.promote', people), serverI18n('de').t)).toBe('Ada (ada@x.org) hat Bob (bob@x.org) zum Admin gemacht')
  })
})
