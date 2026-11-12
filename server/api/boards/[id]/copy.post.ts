import { sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  name: z.string().trim().min(1).max(100),
  teamId: z.uuid().nullable().default(null),
  withCards: z.boolean().default(true),
})

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { name, teamId, withCards } = await readValidated(event, body)
  // Reads the source and writes the copy through RLS; see app.copy_board.
  const [board] = await tx.execute<{ id: string, name: string }>(sql`select id, name from app.copy_board(${id}, ${name}, ${teamId}, ${withCards})`)
  await copyAppearance(tx, id, board!.id)
  return board
})

/** Gives the copy the source's accent, column outline and background (and uploaded image) when the caller owns the copy. */
async function copyAppearance(tx: Tx, src: string, dest: string) {
  const [row] = await tx.execute<{ kind: string | null, accent: string | null, outline: boolean, owner: boolean }>(sql`
    select background->>'kind' as kind, accent, column_outline is not null as outline, app.board_role(${dest}) = 'owner' as owner from boards where id = ${src}`)
  if (!row?.owner) return
  if (row.accent) await tx.execute(sql`update boards set accent = ${row.accent} where id = ${dest}`)
  if (row.outline) await tx.execute(sql`update boards set column_outline = (select column_outline from boards where id = ${src}) where id = ${dest}`)
  if (!row.kind) return
  if (row.kind === 'upload') {
    const image = await tx.execute(sql`
      insert into board_backgrounds (board_id, content_type, size, data)
      select ${dest}, content_type, size, data from board_backgrounds where board_id = ${src}
      returning 1`)
    if (!image.length) return
  }
  await tx.execute(sql`update boards set background = (select background from boards where id = ${src}) where id = ${dest}`)
}
