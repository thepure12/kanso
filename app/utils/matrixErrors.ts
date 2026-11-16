import type { MatrixProblem } from '#shared/types/matrix'

const problems: MatrixProblem[] = ['token', 'rateLimited', 'encrypted', 'cannotJoin', 'eventHidden', 'notInRoom', 'forbidden', 'httpAuth', 'unreachable']

type Translate = (key: string, named?: Record<string, unknown>) => string

/**
 * An explanation of a failed Matrix request in the user's language, from the
 * `data.problem` and `data.bot` the server adds to Matrix 400s; null for
 * other errors. The homeserver's own text follows on a new line.
 */
export function matrixErrorText(err: unknown, t: Translate): string | null {
  const body = (err as { data?: { statusMessage?: string, data?: { problem?: unknown, bot?: unknown } } } | null)?.data
  const problem = body?.data?.problem
  if (typeof problem !== 'string' || !problems.includes(problem as MatrixProblem)) return null
  const bot = typeof body?.data?.bot === 'string' && body.data.bot ? body.data.bot : t('matrix.errors.theBot')
  const text = t(`matrix.errors.${problem}`, { bot })
  return body?.statusMessage ? `${text}\n${body.statusMessage}` : text
}
