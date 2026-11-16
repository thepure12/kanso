import { describe, expect, it } from 'vitest'
import { matrixErrorText } from '../../app/utils/matrixErrors'
import { MatrixError, matrixProblem } from '../../server/utils/matrix'
import { serverI18n } from '../../server/utils/i18n'

describe('matrixProblem', () => {
  const problem = (errcode: string | null, message = '', status: number | null = 400) => matrixProblem(new MatrixError(message, status, errcode))

  it('names what went wrong', () => {
    expect(problem('M_UNKNOWN_TOKEN', '', 401)).toBe('token')
    expect(problem('M_LIMIT_EXCEEDED', '', 429)).toBe('rateLimited')
    expect(problem('KANSO_EVENT_HIDDEN', '', 404)).toBe('eventHidden')
    expect(problem('M_FORBIDDEN', 'M_FORBIDDEN: User @bot:x not in room !r:x, and room previews are disabled', 403)).toBe('notInRoom')
    expect(problem('M_FORBIDDEN', 'M_FORBIDDEN: The user is not in the room', 403)).toBe('notInRoom')
    expect(problem('M_FORBIDDEN', 'M_FORBIDDEN: You don\'t have permission to post', 403)).toBe('forbidden')
  })

  it('tells a proxy refusal and an unreachable server from Matrix errors', () => {
    expect(problem(null, 'HTTP 401', 401)).toBe('httpAuth')
    expect(problem(null, 'connect ECONNREFUSED', null)).toBe('unreachable')
    expect(problem(null, 'HTTP 502', 502)).toBe('unreachable')
    expect(problem(null, 'HTTP 400', 400)).toBeNull()
    expect(problem('M_UNRECOGNIZED')).toBeNull()
  })
})

describe('matrixErrorText', () => {
  const { t } = serverI18n('en')
  const err = (data: Record<string, unknown>, statusMessage = 'Matrix: M_FORBIDDEN: nope') => ({ data: { statusMessage, data } })

  it('explains a known problem with the bot and keeps the homeserver text', () => {
    const text = matrixErrorText(err({ problem: 'notInRoom', bot: '@kanso:x' }), t)!
    expect(text).toMatch(/^@kanso:x is no longer in the room/)
    expect(text.split('\n')[1]).toBe('Matrix: M_FORBIDDEN: nope')
    expect(matrixErrorText(err({ problem: 'notInRoom', bot: null }), t)).toMatch(/^the bot is no longer/)
  })

  it('leaves other errors alone', () => {
    expect(matrixErrorText(err({ problem: null }), t)).toBeNull()
    expect(matrixErrorText(err({ problem: 'whatever' }), t)).toBeNull()
    expect(matrixErrorText({ data: { statusMessage: 'x' } }, t)).toBeNull()
    expect(matrixErrorText(null, t)).toBeNull()
  })
})
