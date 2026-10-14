/** Postgres SQLSTATE of an error, unwrapping drizzle's query error. */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown, cause?: { code?: unknown } }
  if (typeof e?.code === 'string') return e.code
  if (typeof e?.cause?.code === 'string') return e.cause.code
}

/** Name of the constraint an error violated, if any. */
function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint_name?: unknown, cause?: { constraint_name?: unknown } }
  const name = e?.constraint_name ?? e?.cause?.constraint_name
  return typeof name === 'string' ? name : undefined
}

/** Maps database errors raised by RLS, triggers and constraints to HTTP errors. */
export function toHttpError(err: unknown): never {
  switch (pgCode(err)) {
    case '42501':
      throw createError({ statusCode: 403, statusMessage: 'You do not have permission to do that' })
    case 'P0002':
      throw createError({ statusCode: 404, statusMessage: 'No user with that email' })
    case '23514':
      if (pgConstraint(err) === 'cards_start_before_due') throw createError({ statusCode: 400, statusMessage: 'The start date must be on or before the due date' })
      if (pgConstraint(err) === 'cards_estimate_range') throw createError({ statusCode: 400, statusMessage: 'The estimate cannot be negative' })
      if (pgConstraint(err)?.startsWith('card_recurrences_')) throw createError({ statusCode: 400, statusMessage: 'Invalid schedule' })
      if (pgConstraint(err) === 'card_links_not_self') throw createError({ statusCode: 400, statusMessage: 'A card cannot link to itself' })
      throw createError({ statusCode: 409, statusMessage: 'There must be at least one owner left' })
    case '23505':
      if (pgConstraint(err)?.startsWith('card_links_')) throw createError({ statusCode: 409, statusMessage: 'These cards are already linked' })
      throw createError({ statusCode: 409, statusMessage: 'That name is already taken' })
    case 'KB001':
      throw createError({ statusCode: 403, statusMessage: 'Invites are limited to the allowed email domains and addresses' })
    case 'KB002':
      throw createError({ statusCode: 409, statusMessage: 'There must be at least one admin left' })
    case 'KB003':
      throw createError({ statusCode: 400, statusMessage: 'The cover must be an image attached to this card' })
    case 'KB004':
      throw createError({ statusCode: 409, statusMessage: 'That link would make the cards block each other in a cycle' })
    case 'KB005':
      throw createError({ statusCode: 400, statusMessage: 'That value does not fit the field' })
    case 'KB006':
      throw createError({ statusCode: 400, statusMessage: 'Invalid field options' })
    case 'KB007':
      throw createError({ statusCode: 400, statusMessage: 'A card cannot become a template or stop being one' })
    case 'KB008':
      throw createError({ statusCode: 400, statusMessage: 'That card is not a template' })
    case '23503':
    case '22P02':
      throw createError({ statusCode: 400, statusMessage: 'Invalid reference' })
  }
  throw err
}

export function notFound(what = 'Not found'): never {
  throw createError({ statusCode: 404, statusMessage: what })
}
