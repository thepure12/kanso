import { lookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'

// Addresses a webhook must not reach: this host, private networks, link-local
// (cloud metadata at 169.254.169.254), CGNAT, multicast, reserved and
// documentation ranges. IPv4-mapped and NAT64 IPv6 addresses are refused
// outright rather than unwrapped.
// Two lists: an IPv6 rule such as ::ffff:0:0/96 would also match every IPv4 address.
const blocked4 = new BlockList()
const blocked6 = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked4.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked6.addSubnet(net, bits, 'ipv6')

/** Whether `ip` is an address webhooks may not be sent to. Anything that is not an IP counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return blocked4.check(ip, 'ipv4')
  if (v === 6) return blocked6.check(ip, 'ipv6')
  return true
}

/**
 * Checks a webhook URL's shape: http(s), no credentials, and no blocked IP
 * literal unless `allowPrivate`. Hostnames are checked when connecting
 * (safeLookup), so DNS cannot be switched between check and use. Returns an
 * error message, or null when fine.
 */
export function webhookUrlProblem(raw: string, allowPrivate: boolean): string | null {
  let u: URL
  try {
    u = new URL(raw)
  }
  catch {
    return 'Invalid URL'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https URLs are allowed'
  if (u.username || u.password) return 'URLs with credentials are not allowed'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!allowPrivate && (isIP(host) ? isBlockedAddress(host) : host === 'localhost' || host.endsWith('.localhost'))) {
    return 'That address is not reachable from here'
  }
  return null
}

/** dns.lookup that fails when any address the name resolves to is blocked. */
function safeLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0)
      const list = addresses as { address: string, family: number }[]
      const bad = !allowPrivate && list.some(a => isBlockedAddress(a.address))
      if (bad || !list.length) return callback(new Error(`${hostname} resolves to an address that is not allowed`), '', 0)
      if ((options as { all?: boolean }).all) return (callback as (e: null, a: typeof list) => void)(null, list)
      callback(null, list[0]!.address, list[0]!.family)
    })
  }
}

export interface PostResult {
  ok: boolean
  status: number | null
  error: string | null
  /** Start of the response body (500 bytes), for logs. */
  body?: string
}

/**
 * POSTs `body` and reports the outcome; never throws. 2xx is success.
 * Redirects are not followed, the whole exchange times out after `timeoutMs`
 * and at most 64 KB of the response is read.
 */
export async function postWebhook(url: string, body: string | Buffer, headers: Record<string, string>, allowPrivate: boolean, timeoutMs = 5000): Promise<PostResult> {
  const r = await httpRequest({ method: 'POST', url, body, headers, allowPrivate, timeoutMs, maxBytes: 65_536, truncate: true })
  return r.ok ? { ok: true, status: r.status, error: null } : { ok: false, status: r.status, error: r.error, ...(r.body !== undefined && { body: r.body.slice(0, 500) }) }
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT'
  url: string
  body?: string | Buffer
  headers?: Record<string, string>
  allowPrivate: boolean
  timeoutMs?: number
  /** Most response bytes read. */
  maxBytes?: number
  /** Past maxBytes: keep what was read (true) or fail with "Response too large" (false). */
  truncate?: boolean
}

export interface HttpResult {
  ok: boolean
  status: number | null
  error: string | null
  /** Response body (utf8), when a response arrived. */
  body?: string
  /** The same body as bytes (for binary downloads). */
  bytes?: Buffer
  /** Response content-type header. */
  contentType?: string
}

/**
 * One HTTP(S) request to a user-supplied URL with the webhook protections:
 * URL shape check, no private addresses (checked when connecting), no
 * redirects, a time limit and a size limit. Never throws. 2xx is ok.
 */
export function httpRequest(req: HttpRequest): Promise<HttpResult> {
  const { method, url, body, headers = {}, allowPrivate, timeoutMs = 5000, maxBytes = 1_048_576, truncate = false } = req
  const problem = webhookUrlProblem(url, allowPrivate)
  if (problem) return Promise.resolve({ ok: false, status: null, error: problem })
  const u = new URL(url)
  const mod = u.protocol === 'https:' ? https : http
  return new Promise((resolve) => {
    let done = false
    const finish = (r: HttpResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    const r = mod.request(u, {
      method,
      headers: body === undefined ? headers : { ...headers, 'content-length': Buffer.byteLength(body).toString() },
      lookup: safeLookup(allowPrivate),
      agent: false,
    }, (res) => {
      const status = res.statusCode ?? 0
      const chunks: Buffer[] = []
      let size = 0
      let tooLarge = false
      res.on('data', (chunk: Buffer) => {
        if (tooLarge) return
        size += chunk.length
        if (size > maxBytes) {
          tooLarge = true
          chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)))
          res.destroy()
          return
        }
        chunks.push(chunk)
      })
      const settle = () => {
        const bytes = Buffer.concat(chunks)
        const text = bytes.toString('utf8')
        if (tooLarge && !truncate) return finish({ ok: false, status, error: 'Response too large' })
        finish(status >= 200 && status < 300
          ? { ok: true, status, error: null, body: text, bytes, contentType: res.headers['content-type'] }
          : { ok: false, status, error: status >= 300 && status < 400 ? `Redirect (HTTP ${status}) not followed` : `HTTP ${status}`, body: text })
      }
      res.on('end', settle)
      res.on('close', settle)
      res.on('error', settle)
    })
    const timer = setTimeout(() => {
      finish({ ok: false, status: null, error: `Timed out after ${timeoutMs / 1000}s` })
      r.destroy()
    }, timeoutMs)
    r.on('error', err => finish({ ok: false, status: null, error: err.message }))
    r.end(body)
  })
}
