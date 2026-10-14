import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ admin: z.boolean() })

/** Promotes or demotes an admin. RLS: admins only; promotion needs a verified account. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { admin } = await readValidated(event, body)
  if (admin) {
    await tx.insert(schema.instanceAdmins).values({ userId: id }).onConflictDoNothing()
  }
  else {
    const [mine] = await tx.select().from(schema.instanceAdmins).where(eq(schema.instanceAdmins.userId, id))
    // Without admin rights the row is invisible, so this is also the permission error.
    if (!mine) notFound('No admin with that id')
    await tx.delete(schema.instanceAdmins).where(eq(schema.instanceAdmins.userId, id))
  }
  return { id, admin }
})
