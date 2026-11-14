import { describe, expect, it } from 'vitest'
import { channelOn, notificationEvent, notificationPrefsSchema, withChannel } from '../../shared/notificationSettings'

describe('notificationEvent', () => {
  it('turns a comment mentioning the user into a mention', () => {
    expect(notificationEvent('commented', { mentions: ['u1'] }, 'u1')).toBe('mentioned')
    expect(notificationEvent('commented', { mentions: ['u2'] }, 'u1')).toBe('commented')
    expect(notificationEvent('mentioned', {}, 'u1')).toBe('mentioned')
    expect(notificationEvent('moved', null, 'u1')).toBe('moved')
    expect(notificationEvent('renamed', null, 'u1')).toBeNull()
  })
})

describe('channelOn', () => {
  it('defaults to on, and push/email need the inbox', () => {
    expect(channelOn({}, 'moved', 'push')).toBe(true)
    expect(channelOn({ moved: { push: false } }, 'moved', 'push')).toBe(false)
    expect(channelOn({ moved: { inbox: false, email: true } }, 'moved', 'email')).toBe(false)
    expect(channelOn({ moved: { inbox: false } }, 'moved', 'inbox')).toBe(false)
  })
})

describe('withChannel', () => {
  it('stores only what is off', () => {
    const off = withChannel({}, 'due', 'email', false)
    expect(off).toEqual({ due: { email: false } })
    expect(withChannel(off, 'due', 'email', true)).toEqual({})
    expect(withChannel(off, 'due', 'push', false)).toEqual({ due: { email: false, push: false } })
  })
})

describe('notificationPrefsSchema', () => {
  it('rejects unknown events and channels', () => {
    expect(notificationPrefsSchema.safeParse({ moved: { push: false } }).success).toBe(true)
    expect(notificationPrefsSchema.safeParse({ nope: {} }).success).toBe(false)
    expect(notificationPrefsSchema.safeParse({ moved: { sms: false } }).success).toBe(false)
  })
})
