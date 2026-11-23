import type { Credentials } from './config.ts'
import { CliError } from './io.ts'
import { VERSION } from './version.ts'

/** An error response of the Kanso API (h3: `{statusCode, statusMessage, message, data}`). */
export class ApiError extends CliError {
  constructor(readonly status: number, readonly serverMessage: string, readonly data: unknown, message: string) {
    super(message)
  }
}

/** The user-facing text for an error status, with what to do about it. */
export function describeApiError(status: number, serverMessage: string, method: string, path: string): string {
  const what = serverMessage && serverMessage !== String(status) ? `: ${serverMessage}` : ''
  switch (status) {
    case 401:
      return `The token was refused (401${what}). It is unknown, revoked or expired. Create a new one under Account → API tokens and run kanso login again.`
    case 403:
      return `Not allowed (403${what}). The token may be read-only, limited to other boards, or your role on the board does not allow ${method} ${path}.`
    case 404:
      return `Not found (404${what}). It does not exist or you cannot see it.`
    case 429:
      return `Too many requests (429${what}). Wait a few minutes and try again.`
    default:
      return `${method} ${path} failed with ${status}${what}.`
  }
}

/** A JSON client for one Kanso site, sending the API token as a Bearer token. */
export function createClient(creds: Pick<Credentials, 'url' | 'token'>, fetch: typeof globalThis.fetch, clientId = 'cli') {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(creds.url + path, {
        method,
        redirect: 'manual',
        headers: {
          'authorization': `Bearer ${creds.token}`,
          'accept': 'application/json',
          'user-agent': `kanso-cli/${VERSION}`,
          // Board change events from this client are not skipped by any browser tab;
          // `kanso agent run` uses its own id so its event stream skips its own comments.
          'x-client-id': clientId,
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      const cause = (err as { cause?: { code?: string, message?: string } }).cause
      throw new CliError(`Cannot reach ${creds.url}: ${cause?.code ?? cause?.message ?? (err as Error).message}`)
    }
    const type = res.headers.get('content-type') ?? ''
    const text = await res.text()
    let data: unknown = text
    if (type.includes('json') && text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (res.status >= 300 && res.status < 400) {
      throw new CliError(`${method} ${path} was redirected (${res.status}) to ${res.headers.get('location') ?? '?'}. Check the site URL (base path, http vs https).`)
    }
    if (!res.ok) {
      const d = data as { message?: string, statusMessage?: string } | string
      const message = typeof d === 'object' && d ? (d.message || d.statusMessage || '') : ''
      throw new ApiError(res.status, message, data, describeApiError(res.status, message, method, path))
    }
    if (!type.includes('json')) {
      if (res.status === 204 || !text) return undefined as T
      throw new CliError(`${method} ${path} did not answer with JSON. Is ${creds.url} a Kanso site?`)
    }
    return data as T
  }
  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
  }
}

export type Client = ReturnType<typeof createClient>
