import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * TOTP (RFC 6238) as authenticator apps expect it: HMAC-SHA1, 6 digits,
 * 30-second steps. Codes from the step before and after are accepted too, for
 * clock drift.
 */
const STEP_SECONDS = 30
const DIGITS = 6
const WINDOW = 1
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = BASE32.indexOf(ch)
    if (i < 0) throw new Error('Invalid base32')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new random 160-bit secret, base32 (what authenticator apps take). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS)
}

/** The code for a time step (RFC 4226 HOTP with the step as counter). */
export function totpCode(secret: Buffer, step: number, digits = DIGITS, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac(algorithm, secret).update(counter).digest()
  const offset = mac[mac.length - 1]! & 0xf
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits
  return bin.toString().padStart(digits, '0')
}

/**
 * The step a code matches within the window, or null. The caller stores it
 * and refuses steps not newer than the last one used, so a code works once.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs = Date.now()): number | null {
  const given = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(given)) return null
  const secret = base32Decode(secretBase32)
  const now = totpStep(nowMs)
  let match: number | null = null
  // Check every step, so timing does not tell which one matched.
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(given))) match ??= step
  }
  return match
}

/** otpauth:// URI for the QR code. */
export function totpUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) })
  return `otpauth://totp/${label}?${params}`
}

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Ten one-time recovery codes like `k7m2p-q9xwa` (about 49 bits each). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)])
    return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`
  })
}

/** Stored form of a recovery code: sha256 of the code without dashes or spaces, lower case. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.toLowerCase().replace(/[\s-]/g, '')).digest('hex')
}
