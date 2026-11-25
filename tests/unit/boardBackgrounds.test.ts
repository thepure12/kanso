import { describe, expect, it } from 'vitest'
import colors from 'tailwindcss/colors'
import { backgroundStyle, isPresetBackground, logoBackgroundId } from '../../shared/boardBackgrounds'

describe('Kanso logo background', () => {
  const logo = { kind: 'gradient', value: logoBackgroundId } as const

  it('is a preset the API accepts', () => {
    expect(isPresetBackground(logo)).toBe(true)
  })

  it('follows the board accent', () => {
    const style = backgroundStyle(logo, 'b', false, '', 'teal')!
    expect(style.backgroundColor).toBe(colors.teal[600])
    expect(style.backgroundImage).toContain('data:image/svg+xml')
    expect(style.backgroundImage).toContain(colors.teal[400])
    expect(style.backgroundImage).toContain(colors.teal[900])
  })

  it('uses the app primary colour without an accent', () => {
    const style = backgroundStyle(logo, 'b')!
    expect(style.backgroundColor).toBe('var(--ui-color-primary-600)')
    expect(style.backgroundImage).toContain('var(--ui-color-primary-400)')
  })

  it('leaves other gradients alone', () => {
    expect(backgroundStyle({ kind: 'gradient', value: 'ocean' }, 'b', false, '', 'teal'))
      .toEqual({ backgroundImage: expect.stringContaining('#0ea5e9') })
  })
})
