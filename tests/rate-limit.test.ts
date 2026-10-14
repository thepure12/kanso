// Tests for the durable rate limiter (app.hit_rate_limit), as kanban_auth.
// Keys are random per run; rows left behind expire and get purged.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

const key = () => `test:${randomUUID()}`
const hit = async (k: string, limit = 3, win = '1 minute') =>
  (await auth`select app.hit_rate_limit(${k}, ${limit}, ${win}::interval) as ok`)[0]!.ok as boolean

afterAll(async () => {
  await owner`delete from rate_limits where key like 'test:%'`
  await Promise.all([app.end(), auth.end(), owner.end()])
})

describe('rate limit', () => {
  it('allows up to the limit per window, then refuses', async () => {
    const k = key()
    expect([await hit(k), await hit(k), await hit(k)]).toEqual([true, true, true])
    expect(await hit(k)).toBe(false)
    expect(await hit(k)).toBe(false)
    // Other keys are counted separately.
    expect(await hit(key())).toBe(true)
  })

  it('counts concurrent hits atomically', async () => {
    const k = key()
    const results = await Promise.all(Array.from({ length: 10 }, () => hit(k, 4)))
    expect(results.filter(Boolean)).toHaveLength(4)
    const [row] = await owner`select count from rate_limits where key = ${k}`
    expect(row!.count).toBe(10)
  })

  it('starts a new window once the old one has expired', async () => {
    const k = key()
    expect(await hit(k, 1)).toBe(true)
    expect(await hit(k, 1)).toBe(false)
    await owner`update rate_limits set reset_at = now() - interval '1 second' where key = ${k}`
    expect(await hit(k, 1)).toBe(true)
    expect(await hit(k, 1)).toBe(false)
  })

  it('purges expired rows of other keys', async () => {
    const stale = key()
    await hit(stale)
    await owner`update rate_limits set reset_at = now() - interval '1 second' where key = ${stale}`
    await hit(key())
    expect(await owner`select 1 from rate_limits where key = ${stale}`).toHaveLength(0)
  })

  it('is closed to kanban_app and to direct table access', async () => {
    await expect(app`select app.hit_rate_limit('x', 1, '1 minute')`).rejects.toMatchObject({ code: '42501' })
    await expect(auth`select * from rate_limits`).rejects.toMatchObject({ code: '42501' })
    await expect(auth`delete from rate_limits`).rejects.toMatchObject({ code: '42501' })
    await expect(app`select * from rate_limits`).rejects.toMatchObject({ code: '42501' })
  })
})
