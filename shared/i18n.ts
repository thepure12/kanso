/**
 * Locales and a small message formatter for code that runs without the
 * vue-i18n runtime: server mails, digest and webhook text, and the shared
 * activity wording (app/utils/activityText.ts), which the client calls with
 * vue-i18n's `t` instead (useI18nContext). Messages are the same JSON files
 * the app loads (i18n/locales/*.json; server: server/utils/i18n.ts).
 */
export const locales = ['en', 'de'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value)
}

/** `t(key, named, plural)` as in vue-i18n: `plural` picks a "|" form and is `{count}`/`{n}` unless named. */
export type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string

/** What locale-aware helpers take: a translate function and the locale for Intl. */
export interface I18nContext {
  t: Translate
  locale: string
}

type Messages = { [key: string]: string | Messages }

function lookup(messages: Messages, key: string): string | undefined {
  let node: string | Messages | undefined = messages
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** vue-i18n's default plural rule: "one | many" or "zero | one | many". */
function pluralIndex(count: number, forms: number): number {
  const n = Math.abs(count)
  if (forms === 2) return n ? (n > 1 ? 1 : 0) : 1
  return n ? (n > 1 ? 2 : 1) : 0
}

/**
 * Formats the subset of vue-i18n message syntax the catalogues use:
 * `{name}` placeholders, `{'literal'}` (for @, { and |) and "|" plural forms.
 * Falls back to `fallback`, then to the key.
 */
export function createTranslator(messages: object, fallback?: object): Translate {
  return (key, named = {}, plural) => {
    let message = lookup(messages as Messages, key) ?? (fallback && lookup(fallback as Messages, key))
    if (message === undefined) return key
    const values: Record<string, unknown> = plural === undefined ? named : { count: plural, n: plural, ...named }
    if (plural !== undefined) {
      const forms = message.split(/\s*\|\s*(?![^{]*\})/)
      message = forms[forms.length > 1 ? Math.min(pluralIndex(plural, forms.length), forms.length - 1) : 0]!
    }
    return message.replace(/\{\s*(?:'([^']*)'|(\w+))\s*\}/g, (_, literal: string | undefined, name: string) =>
      literal ?? String(values[name] ?? ''))
  }
}
