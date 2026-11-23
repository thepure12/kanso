/** Output helpers: JSON for --json, aligned plain text otherwise. */

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Rows under a header, columns padded to the widest cell (no colour, so it pipes cleanly). */
export function table(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cells = [headers, ...rows.map(r => headers.map((_, i) => cell(r[i])))]
  const widths = headers.map((_, i) => Math.max(...cells.map(r => (r[i] ?? '').length)))
  return cells.map(r => r.map((c, i) => i === r.length - 1 ? c : (c ?? '').padEnd(widths[i]!)).join('  ').trimEnd()).join('\n') + '\n'
}

/** "Label: value" lines with the labels aligned. */
export function fields(pairs: [string, string | number | boolean | null | undefined][]): string {
  const width = Math.max(...pairs.map(([k]) => k.length)) + 1
  return pairs.map(([k, v]) => `${`${k}:`.padEnd(width)} ${cell(v)}`).join('\n') + '\n'
}

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value).replace(/\s+/g, ' ')
}
