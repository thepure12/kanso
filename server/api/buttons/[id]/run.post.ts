import { z } from 'zod'
import type { ButtonRunResult } from '#shared/buttons'

const body = z.object({
  /** The card a card button runs on. */
  cardId: z.uuid().optional(),
})

/**
 * Runs a button's steps as the caller in one transaction: RLS decides each
 * step, and a refused one changes nothing. Steps whose column, tag or person is
 * gone are skipped and counted.
 */
export default defineUserHandler(async (event, tx): Promise<ButtonRunResult> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cardId } = await readValidated(event, body)
  const button = await loadButton(tx, id)
  if (!button) notFound('Button not found')
  return { skipped: await runButton(tx, button, cardId) }
})
