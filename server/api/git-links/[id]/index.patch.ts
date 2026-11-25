import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardGitLink } from '#shared/types/gitLinks'

const body = z.object({
  columnId: z.uuid().optional(),
  label: gitLabelSchema.optional(),
  closeAction: gitCloseActionSchema.optional(),
  /** A new token; null removes it; absent keeps it. */
  token: gitTokenSchema.optional(),
  active: z.boolean().optional(),
}).refine(b => Object.values(b).some(v => v !== undefined), 'Nothing to update')

/**
 * Changes a link (board_git_links_update: owners). A new label or token, or
 * turning it back on, makes the next sync fetch every open issue again.
 */
export default defineUserHandler(async (event, tx): Promise<BoardGitLink> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { token, ...patch } = await readValidated(event, body)
  const g = schema.boardGitLinks
  const set = { ...patch, ...(token !== undefined && { token: token ? sealGitToken(token) : null }) }
  const [row] = await tx.update(g).set(set).where(eq(g.id, id)).returning(gitLinkColumns)
  return row ? toBoardGitLink(row) : notFound('Repository link not found')
})
