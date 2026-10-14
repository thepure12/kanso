import type { I18nContext } from '#shared/i18n'
import type { BoardField, FieldKind, FieldValue } from '#shared/types/board'
import { formatDate } from './format'

/** Icon per field kind; the label is `t('cardFields.kind.<kind>')`. */
export const fieldKindMeta: Record<FieldKind, { icon: string }> = {
  text: { icon: 'i-lucide-type' },
  number: { icon: 'i-lucide-hash' },
  date: { icon: 'i-lucide-calendar' },
  select: { icon: 'i-lucide-list' },
  checkbox: { icon: 'i-lucide-square-check' },
  url: { icon: 'i-lucide-link' },
}

/** The host of an http(s) URL without "www.", or the URL itself when it does not parse. */
export function urlHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return url }
}

/**
 * A value as short text: option label for select fields, "Yes"/"No" for
 * checkboxes, formatted dates and numbers, URL hosts. Null when there is no
 * value or its select option is gone.
 */
export function formatFieldValue(field: Pick<BoardField, 'kind' | 'options'>, value: FieldValue | null | undefined, i18n: I18nContext): string | null {
  if (value === null || value === undefined) return null
  switch (field.kind) {
    case 'select': return field.options.find(o => o.id === value)?.label ?? null
    case 'checkbox': return i18n.t(value ? 'cardFields.yes' : 'cardFields.no')
    case 'date': return typeof value === 'string' ? formatDate(value, i18n.locale) : String(value)
    case 'number': return typeof value === 'number' ? value.toLocaleString(i18n.locale) : String(value)
    case 'url': return urlHost(String(value))
    case 'text': return String(value)
  }
}

/** Filter key of a value (see CardFilter.fields): 'none' for no value and unticked checkboxes, else the value as text. */
export function fieldFilterKey(value: FieldValue | null | undefined): string {
  return value === null || value === undefined || value === false ? 'none' : String(value)
}

/** Fields whose values can be filtered on: select and checkbox. */
export const isFilterableField = (f: Pick<BoardField, 'kind'>) => f.kind === 'select' || f.kind === 'checkbox'
