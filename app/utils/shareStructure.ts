/**
 * Structural sharing for reloaded data: returns `next`, but with every part that equals the same
 * part of `prev` replaced by `prev`'s object, so unchanged cards, tags and members keep their
 * identity across a board reload. Components that get them as props then skip re-rendering; on a
 * board with hundreds of cards a reload caused by someone else's change otherwise re-rendered
 * every card and froze typing for a moment.
 *
 * Plain JSON data only (objects, arrays, primitives). `prev` must be raw data (`toRaw`), not a
 * reactive proxy. Array items are matched by `id` when every item has one, else by index.
 */
export function shareStructure<T>(prev: unknown, next: T): T {
  return share(prev, next) as T
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function share(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) return prev
  if (Array.isArray(prev) && Array.isArray(next)) return shareArray(prev, next)
  if (isObject(prev) && isObject(next)) return shareObject(prev, next)
  return next
}

function shareObject(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const nextKeys = Object.keys(next)
  let same = nextKeys.length === Object.keys(prev).length
  const out: Record<string, unknown> = {}
  for (const key of nextKeys) {
    const value = Object.hasOwn(prev, key) ? share(prev[key], next[key]) : next[key]
    out[key] = value
    if (same && (!Object.hasOwn(prev, key) || value !== prev[key])) same = false
  }
  return same ? prev : out
}

function idOf(v: unknown): string | undefined {
  return isObject(v) && typeof v.id === 'string' ? v.id : undefined
}

function shareArray(prev: unknown[], next: unknown[]) {
  let byId: Map<string, unknown> | undefined
  if (prev.length && prev.every(idOf) && next.every(idOf)) byId = new Map(prev.map(v => [idOf(v)!, v]))
  const out = next.map((v, i) => share(byId ? byId.get(idOf(v)!) : prev[i], v))
  return sameItems(prev, out) ? prev : out
}

/** Same length and the very same items in the same order. */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
