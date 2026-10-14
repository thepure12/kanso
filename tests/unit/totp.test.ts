import { describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, totpCode, totpStep, totpUri, verifyTotp } from '../../server/utils/totp'
import { openSecret, sealSecret, secretKey } from '../../server/utils/secretBox'

describe('base32', () => {
  // RFC 4648 section 10 (without padding).
  it.each([['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']])('%j <-> %s', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain))).toBe(encoded)
    expect(base32Decode(encoded).toString()).toBe(plain)
  })

  it('decodes lower case, spaces and padding; rejects other characters', () => {
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar')
    expect(() => base32Decode('MZ1W')).toThrow()
  })
})

describe('TOTP', () => {
  // RFC 6238 appendix B, SHA1, 8 digits.
  const rfcSecret = Buffer.from('12345678901234567890')
  it.each([[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']])('RFC 6238 vector at %i', (t, code) => {
    expect(totpCode(rfcSecret, totpStep(t * 1000), 8)).toBe(code)
  })

  it('RFC 6238 vectors for SHA256 and SHA512', () => {
    expect(totpCode(Buffer.from('12345678901234567890123456789012'), totpStep(59_000), 8, 'sha256')).toBe('46119246')
    expect(totpCode(Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'), totpStep(59_000), 8, 'sha512')).toBe('90693936')
  })

  it('accepts the current code and one step either side, and returns its step', () => {
    const secret = generateTotpSecret()
    const now = 1_700_000_000_000
    const step = totpStep(now)
    const raw = base32Decode(secret)
    expect(verifyTotp(secret, totpCode(raw, step), now)).toBe(step)
    expect(verifyTotp(secret, totpCode(raw, step - 1), now)).toBe(step - 1)
    expect(verifyTotp(secret, totpCode(raw, step + 1), now)).toBe(step + 1)
    expect(verifyTotp(secret, totpCode(raw, step - 2), now)).toBeNull()
    expect(verifyTotp(secret, totpCode(raw, step + 2), now)).toBeNull()
    // Spaces are fine; other lengths and characters are not.
    const code = totpCode(raw, step)
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(step)
    expect(verifyTotp(secret, code.slice(1), now)).toBeNull()
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull()
  })

  it('makes 160-bit secrets and an otpauth URI', () => {
    const secret = generateTotpSecret()
    expect(base32Decode(secret)).toHaveLength(20)
    expect(generateTotpSecret()).not.toBe(secret)
    const uri = new URL(totpUri(secret, 'ada@example.com', 'Kanso'))
    expect(uri.protocol).toBe('otpauth:')
    expect(uri.host).toBe('totp')
    expect(decodeURIComponent(uri.pathname)).toBe('/Kanso:ada@example.com')
    expect(uri.searchParams.get('secret')).toBe(secret)
    expect(uri.searchParams.get('period')).toBe('30')
  })
})

describe('recovery codes', () => {
  it('are ten distinct codes; the hash ignores case, dashes and spaces', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/)
    const h = hashRecoveryCode(codes[0]!)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(hashRecoveryCode(` ${codes[0]!.toUpperCase().replace('-', '')} `)).toBe(h)
    expect(hashRecoveryCode(codes[1]!)).not.toBe(h)
  })
})

describe('secret box', () => {
  const key = secretKey('a-session-password-of-at-least-32-chars')

  it('round-trips, with a fresh IV each time', () => {
    const a = sealSecret('JBSWY3DPEHPK3PXP', key)
    const b = sealSecret('JBSWY3DPEHPK3PXP', key)
    expect(a).not.toBe(b)
    expect(a.startsWith('v1.')).toBe(true)
    expect(openSecret(a, key)).toBe('JBSWY3DPEHPK3PXP')
  })

  it('refuses another key, tampering and malformed input', () => {
    const box = sealSecret('secret', key)
    expect(openSecret(box, secretKey('another-password-of-at-least-32-characters'))).toBeNull()
    // A different HKDF info gives a different key from the same material.
    expect(openSecret(box, secretKey('a-session-password-of-at-least-32-chars', 'other'))).toBeNull()
    const [v, iv, tag, ct] = box.split('.')
    const flipped = Buffer.from(ct!, 'base64url')
    flipped[0]! ^= 1
    expect(openSecret([v, iv, tag, flipped.toString('base64url')].join('.'), key)).toBeNull()
    expect(openSecret([v, iv, tag!.slice(0, 8), ct].join('.'), key)).toBeNull()
    expect(openSecret('v1.abc', key)).toBeNull()
    expect(openSecret(`${box}.x`, key)).toBeNull()
  })

  it('needs a 32-character key', () => {
    expect(() => secretKey('short')).toThrow()
  })
})
