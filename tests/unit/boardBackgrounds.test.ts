import { describe, expect, it } from 'vitest'
import colors from 'tailwindcss/colors'
import { backgroundStyle, canShowLogo, presetBackgroundSchema } from '../../shared/boardBackgrounds'

const svg = (style: Record<string, string> | undefined) =>
  decodeURIComponent(style?.backgroundImage?.match(/data:image\/svg\+xml,([^"]*)/)?.[1] ?? '')

describe('Kanso logo on a background', () => {
  it('goes on colours and gradients only', () => {
    expect(canShowLogo({ kind: 'color', value: '#0f766e' })).toBe(true)
    expect(canShowLogo({ kind: 'gradient', value: 'ocean' })).toBe(true)
    expect(canShowLogo({ kind: 'photo', value: 'alps' })).toBe(false)
    expect(canShowLogo({ kind: 'upload', value: 'abc' })).toBe(false)
    expect(canShowLogo(null)).toBe(false)
  })

  it('is drawn in the board accent over a colour', () => {
    const style = backgroundStyle({ kind: 'color', value: '#334155', logo: true }, 'b', false, '', 'teal')!
    expect(style.backgroundColor).toBe('#334155')
    expect(svg(style)).toContain(`stroke="${colors.teal[500]}"`)
    expect(style.backgroundSize).toBe('auto 50vmin')
    expect(style.backgroundAttachment).toBe('fixed')
  })

  it('sits on top of a gradient, in the app colour without an accent', () => {
    const style = backgroundStyle({ kind: 'gradient', value: 'ocean', logo: true }, 'b', true)!
    expect(style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,.*\), linear-gradient\(135deg, #0ea5e9/)
    expect(svg(style)).toContain(`stroke="${colors.indigo[500]}"`)
    expect(style.backgroundSize).toBe('auto 60%, cover')
    expect(style.backgroundAttachment).toBeUndefined()
  })

  it('is left out unless asked for', () => {
    expect(backgroundStyle({ kind: 'gradient', value: 'ocean' }, 'b', false, '', 'teal'))
      .toEqual({ backgroundImage: expect.stringContaining('#0ea5e9') })
    expect(backgroundStyle({ kind: 'color', value: '#334155' }, 'b')).toEqual({ backgroundColor: '#334155' })
  })
})

describe('uploaded backgrounds', () => {
  it('point at the board or custom view image, under the base path', () => {
    const bg = { kind: 'upload', value: 'a1b2' } as const
    expect(backgroundStyle(bg, 'b1', false, '/kanso')!.backgroundImage).toBe('url("/kanso/api/boards/b1/background?v=a1b2")')
    expect(backgroundStyle(bg, { viewId: 'v1' })!.backgroundImage).toBe('url("/api/views/v1/background?v=a1b2")')
  })
})

describe('presetBackgroundSchema', () => {
  it('takes offered colours, gradients and photos and keeps logo only when on', () => {
    expect(presetBackgroundSchema.parse({ kind: 'gradient', value: 'ocean', logo: true })).toEqual({ kind: 'gradient', value: 'ocean', logo: true })
    expect(presetBackgroundSchema.parse({ kind: 'color', value: '#0f766e', logo: false })).toEqual({ kind: 'color', value: '#0f766e' })
    expect(presetBackgroundSchema.safeParse({ kind: 'photo', value: 'alps', logo: true }).success).toBe(false)
    expect(presetBackgroundSchema.safeParse({ kind: 'photo', value: 'nowhere' }).success).toBe(false)
    expect(presetBackgroundSchema.safeParse({ kind: 'upload', value: 'abc' }).success).toBe(false)
  })
})
