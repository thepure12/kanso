/**
 * True when an API error is a name conflict (`data.problem` `nameTaken`, added
 * by `toHttpError` for unique violations), so forms only say "name taken" when
 * it is, not for every 409.
 */
export function isNameTaken(err: unknown): boolean {
  const body = (err as { data?: { data?: { problem?: unknown } } } | null)?.data
  return body?.data?.problem === 'nameTaken'
}
