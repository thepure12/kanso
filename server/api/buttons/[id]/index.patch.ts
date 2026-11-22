import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { buttonColorSchema, buttonColumnIds, buttonIcons, buttonName, buttonTooltip, stepsSchema, type BoardButton } from '#shared/buttons'

const body = z.object({
  name: buttonName.optional(),
  icon: z.enum(buttonIcons).nullable().optional(),
  color: buttonColorSchema.optional(),
  tooltip: buttonTooltip.optional(),
  /** Card buttons only. */
  columnIds: buttonColumnIds.optional(),
  // Checked against the button's scope below.
  steps: z.array(z.unknown()).optional(),
})

/** Changes a button's name, look, columns or steps (not its scope or owner). */
export default defineUserHandler(async (event, tx): Promise<BoardButton> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const button = await loadButton(tx, id)
  if (!button) notFound('Button not found')
  if (input.columnIds != null && button.scope !== 'card') {
    throw createError({ statusCode: 400, statusMessage: 'columnIds: Only card buttons are limited to columns' })
  }
  let steps: BoardButton['steps'] | undefined
  if (input.steps !== undefined) {
    const parsed = stepsSchema(button.scope).safeParse(input.steps)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!
      throw createError({ statusCode: 400, statusMessage: `steps.${issue.path.join('.')}: ${issue.message}`, data: { issues: parsed.error.issues } })
    }
    steps = parsed.data
  }
  const patch = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.icon !== undefined && { icon: input.icon }),
    ...(input.color !== undefined && { color: input.color }),
    ...(input.tooltip !== undefined && { tooltip: input.tooltip }),
    ...(input.columnIds !== undefined && { columnIds: input.columnIds }),
    ...(steps && { steps }),
  }
  if (!Object.keys(patch).length) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })
  const { boardButtons: bb } = schema
  const rows = await tx.update(bb).set(patch).where(eq(bb.id, id)).returning({ id: bb.id })
  if (!rows.length) notFound('Button not found or not allowed')
  return (await loadButton(tx, id))!
})
