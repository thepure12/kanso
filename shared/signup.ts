export type SignupMode = 'open' | 'restricted'

/** Splits a comma, space or newline separated list into trimmed lower-case entries. */
export function parseList(list: string): string[] {
  return list.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
}

/** Lower-cases a domain and drops a leading '@'. */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, '')
}

const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function isDomain(domain: string): boolean {
  return domainPattern.test(domain)
}
