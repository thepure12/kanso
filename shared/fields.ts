import type { BoardField, FieldValue } from './types/board'

export const MAX_FIELD_TEXT = 2000

/**
 * Whether `value` fits the field, as the database checks it (trigger
 * app.check_card_field_value, KB005): text a non-empty string, number a finite
 * number, date a real YYYY-MM-DD date, select one of the option ids, checkbox
 * a boolean, url an http(s) URL. Strings are at most MAX_FIELD_TEXT long.
 */
export function isValidFieldValue(field: Pick<BoardField, 'kind' | 'options'>, value: unknown): value is FieldValue {
  switch (field.kind) {
    case 'text': return typeof value === 'string' && value.length >= 1 && value.length <= MAX_FIELD_TEXT
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'date': return typeof value === 'string' && isIsoDate(value)
    case 'select': return typeof value === 'string' && field.options.some(o => o.id === value)
    case 'checkbox': return typeof value === 'boolean'
    case 'url': return typeof value === 'string' && value.length <= MAX_FIELD_TEXT && /^https?:\/\/[^\s/?#]+\S*$/i.test(value)
  }
}

function isIsoDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d
}
