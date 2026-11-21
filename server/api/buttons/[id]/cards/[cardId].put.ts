import { z } from 'zod'
import type { BoardButton } from '#shared/buttons'

const params = z.object({ id: z.uuid(), cardId: z.uuid() })

/** Adds a card button to one card, whatever its columns (RLS: own personal buttons, shared ones for editors of the card). */
export default defineUserHandler(async (event, tx): Promise<BoardButton> => {
  const { id, cardId } = await paramsValidated(event, params)
  return setButtonOnCard(tx, id, cardId, true)
})
