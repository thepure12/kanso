import { sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  email: z.email(),
  role: z.enum(['owner', 'editor', 'viewer']),
})

export default defineUserHandler(async (event, tx, callerId) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { email, role } = await readValidated(event, body)
  const [existing] = await tx.execute<{ found: boolean }>(sql`select exists (
    select 1 from team_members tm join users u on u.id = tm.user_id
    where tm.team_id = ${id} and u.email = ${email}::citext) as found`)
  const [row] = await tx.execute<{ user_id: string | null }>(sql`select app.add_team_member(${id}, ${email}, ${role}::board_role) as user_id`)
  await mailNewMember(event, tx, { callerId, email, userId: row!.user_id, wasMember: existing!.found, target: { kind: 'team', id } })
  // No account with that email: the function recorded an invite instead.
  if (!row!.user_id) return { invited: true as const, email, role }
  return { userId: row!.user_id, role }
})
