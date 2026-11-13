import { describe, expect, it } from 'vitest'
import { base64UrlToBytes, pushTargetPath, sameServerKey } from '../../app/utils/push'

describe('base64UrlToBytes', () => {
  it('decodes base64url with and without padding', () => {
    expect([...base64UrlToBytes('-_8')]).toEqual([0xFB, 0xFF])
    expect([...base64UrlToBytes('AQID')]).toEqual([1, 2, 3])
    expect([...base64UrlToBytes('AQ==')]).toEqual([1])
  })
})

describe('sameServerKey', () => {
  const key = Buffer.from([4, 1, 2, 3]).toString('base64url')
  it('compares a subscription key with the server key', () => {
    expect(sameServerKey(new Uint8Array([4, 1, 2, 3]).buffer, key)).toBe(true)
    expect(sameServerKey(new Uint8Array([4, 1, 2, 4]).buffer, key)).toBe(false)
    expect(sameServerKey(new Uint8Array([4, 1, 2]).buffer, key)).toBe(false)
    expect(sameServerKey(null, key)).toBe(false)
  })
})

describe('pushTargetPath', () => {
  const origin = 'https://kanso.example'
  it('returns the path below the base path', () => {
    expect(pushTargetPath('https://kanso.example/boards/b?card=c', origin, '')).toBe('/boards/b?card=c')
    expect(pushTargetPath('/kanso/boards/b?card=c', origin, '/kanso')).toBe('/boards/b?card=c')
    expect(pushTargetPath('/kanso', origin, '/kanso')).toBe('/')
  })
  it('refuses other origins and paths outside the base path', () => {
    expect(pushTargetPath('https://evil.example/boards/b', origin, '')).toBeNull()
    expect(pushTargetPath('/other/boards/b', origin, '/kanso')).toBeNull()
    expect(pushTargetPath('/kansox/boards', origin, '/kanso')).toBeNull()
  })
})
