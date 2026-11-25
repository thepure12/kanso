import { describe, expect, it } from 'vitest'
import colors from 'tailwindcss/colors'
import { backgroundStyle, canShowLogo } from '../../shared/boardBackgrounds'

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
