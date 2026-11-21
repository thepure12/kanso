import { z } from 'zod'

// Keyset cursor: base64url of "<created_at as Postgres text>|<id>". The text
// keeps microseconds, which a JS Date would drop, so the keyset stays exact.
// Select `created_at::text` alongside the row and pass it to encodeCursor.
export const cursorParam = z.string().max(200).transform((c, ctx) => {
  const [ts, id] = Buffer.from(c, 'base64url').toString().split('|')
  if (!ts || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?([+-]\d\d(:?\d\d)?|Z)$/.test(ts) || !z.uuid().safeParse(id).success) {
    ctx.addIssue({ code: 'custom', message: 'Invalid cursor' })
    return z.NEVER
  }
  return { ts, id: id! }
})

export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`).toString('base64url')
}
