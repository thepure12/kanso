import type { Translate } from '#shared/i18n'
import type { AuditEntry } from '#shared/types/admin'

const settingKeys = ['signup_mode', 'allowed_domains', 'allowed_emails', 'allow_external_invites']

/** Label of an instance setting column, e.g. "allowed domains" (audit.setting.*). */
export function auditSettingLabel(key: string, t: Translate): string {
  return settingKeys.includes(key) ? t(`audit.setting.${key}`) : key.replaceAll('_', ' ')
}

/** "Ada (ada@x.org)" from the names stored in the entry, which outlive the accounts. */
export function auditPerson(entry: AuditEntry, who: 'actor' | 'target', t: Translate): string {
  const name = entry.data[`${who}_name`]
  const email = entry.data[`${who}_email`]
  if (typeof name === 'string' && typeof email === 'string') return t('audit.person', { name, email })
  return typeof email === 'string' ? email : t('audit.deleted')
}

/** One line describing an audit log entry (`t`: useI18nContext().t, or serverI18n(locale).t). */
export function auditText(entry: AuditEntry, t: Translate): string {
  const actor = auditPerson(entry, 'actor', t)
  const target = auditPerson(entry, 'target', t)
  switch (entry.action) {
    case 'admin.bootstrap': return t('audit.bootstrap', { target })
    case 'admin.promote': return t('audit.promote', { actor, target })
    case 'admin.demote': return t('audit.demote', { actor, target })
    case 'user.remove': return t('audit.remove', { actor, target })
    case 'user.delete_self': return t('audit.deleteSelf', { target })
    case 'settings.update': {
      const fields = Object.keys((entry.data.changes ?? {}) as Record<string, unknown>).map(k => auditSettingLabel(k, t))
      return t('audit.settings', { actor, fields: fields.join(', ') || t('audit.signupSettings') })
    }
    default: return t('audit.other', { actor, action: entry.action })
  }
}
