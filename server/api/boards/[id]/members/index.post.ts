import { sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  email: z.email(),
  role: z.enum(['owner', 'editor', 'viewer']),
})

export default defineUserHandler(async (event, tx, callerId) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { email, role } = await readValidated(event, body)
  // Already on the board (directly or through its team): a role change, no mail.
  const [existing] = await tx.execute<{ found: boolean }>(sql`select exists (
    select 1 from users u
    where u.email = ${email}::citext and (
      exists (select 1 from board_members bm where bm.board_id = ${id} and bm.user_id = u.id)
      or exists (select 1 from boards b join team_members tm on tm.team_id = b.team_id
                 where b.id = ${id} and tm.user_id = u.id))) as found`)
  // Owner check and email lookup happen inside the SECURITY DEFINER function.
  const [row] = await tx.execute<{ user_id: string | null }>(sql`select app.add_board_member(${id}, ${email}, ${role}::board_role) as user_id`)
  await mailNewMember(event, tx, { callerId, email, userId: row!.user_id, wasMember: existing!.found, target: { kind: 'board', id } })
  // No account with that email: the function recorded an invite instead.
  if (!row!.user_id) return { invited: true as const, email, role }
  return { userId: row!.user_id, role }
})
