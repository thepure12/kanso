import { sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  email: z.email(),
  role: z.enum(['owner', 'editor', 'viewer']),
})

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { email, role } = await readValidated(event, body)
  // Owner check and email lookup happen inside the SECURITY DEFINER function.
  const [row] = await tx.execute<{ user_id: string | null }>(sql`select app.add_board_member(${id}, ${email}, ${role}::board_role) as user_id`)
  // No account with that email: the function recorded an invite instead.
  if (!row!.user_id) return { invited: true as const, email, role }
  return { userId: row!.user_id, role }
})
