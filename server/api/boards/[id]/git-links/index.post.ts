import { z } from 'zod'
import type { BoardGitLink } from '#shared/types/gitLinks'

const body = z.object({
  repo: gitRepoSchema,
  columnId: z.uuid(),
  label: gitLabelSchema,
  closeAction: gitCloseActionSchema.default('none'),
  token: gitTokenSchema,
})

/**
 * Links a GitHub repository (board_git_links_insert: owners of unarchived
 * boards; the column must be the board's, composite FK). The token is stored
 * sealed and never returned. The first import runs with the next sync, or
 * at once through POST /api/git-links/:id/sync.
 */
export default defineUserHandler(async (event, tx, userId): Promise<BoardGitLink> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { token, ...values } = await readValidated(event, body)
  const [row] = await tx.insert(schema.boardGitLinks)
    .values({ ...values, boardId: id, token: token ? sealGitToken(token) : null, createdBy: userId })
    .returning(gitLinkColumns)
  return toBoardGitLink(row!)
})
