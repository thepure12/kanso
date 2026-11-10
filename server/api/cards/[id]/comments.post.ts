import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Comment } from '#shared/types/board'

const body = z.object({ body: z.string().trim().min(1).max(10_000) })

export default defineUserHandler(async (event, tx, userId): Promise<Comment> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  const { cardComments: cc, users } = schema
  const [c] = await tx.insert(cc).values({ cardId: id, boardId, authorId: userId, body: input.body }).returning()
  const [me] = await tx.select({ name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId))
  return {
    id: c!.id, authorId: userId, authorName: me?.name ?? null, authorAvatarUrl: me?.avatarUrl ?? null, importedAuthor: null,
    body: c!.body, createdAt: c!.createdAt.toISOString(), updatedAt: c!.updatedAt.toISOString(),
  }
})
