import { z } from 'zod'
import type { BoardButton } from '#shared/buttons'

const params = z.object({ id: z.uuid(), cardId: z.uuid() })

/** Takes a card button off a card it was added to (its columns still apply). */
export default defineUserHandler(async (event, tx): Promise<BoardButton> => {
  const { id, cardId } = await paramsValidated(event, params)
  return setButtonOnCard(tx, id, cardId, false)
})
