import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { type BoardBackground, isPresetBackground } from '#shared/boardBackgrounds'

// Uploaded images go through POST /api/boards/:id/background.
const body = z.object({
  kind: z.enum(['color', 'gradient', 'photo']),
  value: z.string().max(40),
  // The Kanso logo on top: colours and gradients only.
  logo: z.boolean().optional(),
}).refine(bg => isPresetBackground(bg), 'Unknown background')
  .refine(bg => !bg.logo || bg.kind !== 'photo', 'logo: Only on colours and gradients')

export default defineUserHandler(async (event, tx): Promise<{ background: BoardBackground | null }> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { logo, ...bg } = await readValidated(event, body)
  const background = (logo ? { ...bg, logo } : bg) as BoardBackground
  // RLS: only owners of unarchived boards match the UPDATE.
  const [row] = await tx.update(schema.boards).set({ background }).where(eq(schema.boards.id, id))
    .returning({ background: schema.boards.background })
  return row ?? notFound('Board not found or you are not an owner')
})
