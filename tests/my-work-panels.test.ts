// RLS for My work panels: personal rows, each user sees and changes only their own.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const owner_ = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    return fn(sql)
  }) as Promise<T>
}

const created: string[] = []
async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id`
  created.push(u!.id)
  return u!.id as string
}

const config = { people: 'assigned', userIds: [], columns: ['To do'], boardIds: [], tags: [], priorities: [], due: [], showDone: false }
let alice: string, bob: string

beforeAll(async () => {
  ;[alice, bob] = await Promise.all([createUser('alice'), createUser('bob')])
})

afterAll(async () => {
  await owner_`delete from users where id = any(${created})`
  await Promise.all([app.end(), auth.end(), owner_.end()])
})

describe('my work panels', () => {
  it('only their user reads, changes and deletes a panel', async () => {
    const id = await as(alice, async sql => (await sql`
      insert into my_work_panels (user_id, name, config) values (${alice}, 'To do', ${sql.json(config)}) returning id`)[0]!.id as string)
    expect(await as(alice, async sql => (await sql`select 1 from my_work_panels where id = ${id}`).length)).toBe(1)
    expect(await as(bob, async sql => (await sql`select 1 from my_work_panels where id = ${id}`).length)).toBe(0)
    expect(await as(bob, async sql => (await sql`update my_work_panels set name = 'Mine' where id = ${id}`).count)).toBe(0)
    expect(await as(bob, async sql => (await sql`delete from my_work_panels where id = ${id}`).count)).toBe(0)
    expect(await as(alice, async sql => (await sql`update my_work_panels set name = 'Renamed', position = 3 where id = ${id}`).count)).toBe(1)
    // The owner is fixed.
    await expect(as(alice, sql => sql`update my_work_panels set user_id = ${bob} where id = ${id}`)).rejects.toMatchObject({ code: '42501' })
    expect(await as(alice, async sql => (await sql`delete from my_work_panels where id = ${id}`).count)).toBe(1)
  })

  it('nobody adds a panel for someone else', async () => {
    await expect(as(bob, sql => sql`insert into my_work_panels (user_id, name, config) values (${alice}, 'X', ${sql.json(config)})`))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('checks the name length and config shape', async () => {
    await expect(as(alice, sql => sql`insert into my_work_panels (user_id, name, config) values (${alice}, '', ${sql.json(config)})`))
      .rejects.toMatchObject({ code: '23514' })
    await expect(as(alice, sql => sql`insert into my_work_panels (user_id, name, config) values (${alice}, 'X', ${sql.json([1])})`))
      .rejects.toMatchObject({ code: '23514' })
  })
})
