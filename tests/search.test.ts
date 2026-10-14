// Full-text search columns (cards.search, card_comments.search) under RLS.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toPrefixTsquery } from '../server/utils/search'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  return u as { id: string, email: string }
}

// A word unique to this run, so other test data never matches.
const word = `zebra${randomUUID().slice(0, 8)}`
let alice: { id: string, email: string }
let bob: { id: string, email: string }
let aliceBoard: string
let bobBoard: string

/** Card ids matching `text` in their own text or a comment, as `userId` sees them. */
function search(userId: string, text: string) {
  return as(userId, async (sql) => {
    const rows = await sql`
      select c.id, c.title from cards c, to_tsquery('simple', ${toPrefixTsquery(text)!}) q
      where c.search @@ q or exists (select 1 from card_comments cm where cm.card_id = c.id and cm.search @@ q)
      order by c.title`
    return rows.map(r => r.title as string)
  })
}

beforeAll(async () => {
  ;[alice, bob] = await Promise.all([createUser('alice'), createUser('bob')])
  for (const [user, title] of [[alice, 'Alice'], [bob, 'Bob']] as const) {
    await as(user.id, async (sql) => {
      const [{ id: boardId }] = await sql`select id from app.create_board(${`${title} search`})` as any
      const [{ id: columnId }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id` as any
      await sql`insert into cards (board_id, column_id, title, description, position, created_by)
        values (${boardId}, ${columnId}, ${`${title} ${word} title`}, '', 1, ${user.id}),
               (${boardId}, ${columnId}, ${`${title} described`}, ${`Has the ${word}-word inside`}, 2, ${user.id})`
      const [{ id: cardId }] = await sql`insert into cards (board_id, column_id, title, position, created_by)
        values (${boardId}, ${columnId}, ${`${title} commented`}, 3, ${user.id}) returning id` as any
      await sql`insert into card_comments (card_id, board_id, author_id, body) values (${cardId}, ${boardId}, ${user.id}, ${`Mentions ${word.toUpperCase()}`})`
      if (user === alice) aliceBoard = boardId
      else bobBoard = boardId
    })
  }
})

afterAll(async () => {
  await as(alice.id, sql => sql`delete from boards where id = ${aliceBoard}`)
  await as(bob.id, sql => sql`delete from boards where id = ${bobBoard}`)
  await Promise.all([app.end(), auth.end()])
})

describe('search', () => {
  it('matches title, description and comments by word prefix, case-insensitively', async () => {
    expect(await search(alice.id, word.slice(0, 9))).toEqual(['Alice commented', 'Alice described', `Alice ${word} title`])
    expect(await search(alice.id, `${word} titl`)).toEqual([`Alice ${word} title`])
  })

  it('never returns cards or comments from boards the user cannot see', async () => {
    expect(await search(bob.id, word)).toEqual(['Bob commented', 'Bob described', `Bob ${word} title`])
    await as(bob.id, async (sql) => {
      expect(await sql`select id from card_comments where search @@ to_tsquery('simple', ${`${word}:*`}) and board_id = ${aliceBoard}`).toHaveLength(0)
    })
  })

  it('updates the search vector when a card changes', async () => {
    await as(alice.id, sql => sql`update cards set title = 'Renamed' where board_id = ${aliceBoard} and title = ${`Alice ${word} title`}`)
    expect(await search(alice.id, word)).toEqual(['Alice commented', 'Alice described'])
  })
})
