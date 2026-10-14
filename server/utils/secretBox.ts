import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM for secrets kept at rest (TOTP secrets). The key comes from
 * NUXT_TOTP_KEY, or else NUXT_SESSION_PASSWORD, through HKDF-SHA256 with its
 * own info string, so it differs from the session sealing key. Changing the
 * key makes stored secrets unreadable (users then sign in with a recovery code
 * and set up two-factor again). Output: `v1.<iv>.<tag>.<ciphertext>`, base64url.
 */
export function secretKey(material: string, info = 'kanban/totp-secret/v1'): Buffer {
  if (material.length < 32) throw new Error('The encryption key needs at least 32 characters')
  return Buffer.from(hkdfSync('sha256', material, 'kanban', info, 32))
}

export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), ct].map(p => typeof p === 'string' ? p : p.toString('base64url')).join('.')
}

/** The plaintext, or null when the box is malformed, tampered with or sealed with another key. */
export function openSecret(box: string, key: Buffer): string | null {
  const [v, iv, tag, ct, extra] = box.split('.')
  if (v !== 'v1' || !iv || !tag || ct === undefined || extra !== undefined) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: 16 })
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
  }
  catch { return null }
}
