import { describe, expect, it } from 'vitest'
import { themeColorMeta, themeColors } from '../../app/utils/themeColor'

describe('themeColorMeta', () => {
  it('sends both colours with media queries while the mode is unknown', () => {
    const meta = themeColorMeta('dark', true)
    expect(meta).toHaveLength(2)
    expect(meta.map(m => m.media)).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'])
  })

  it('follows the colour mode chosen in the app', () => {
    expect(themeColorMeta('dark', false)).toEqual([{ name: 'theme-color', content: themeColors.dark }])
    expect(themeColorMeta('light', false)).toEqual([{ name: 'theme-color', content: themeColors.light }])
  })

  it('falls back to media queries for an unexpected mode', () => {
    expect(themeColorMeta('system', false)).toHaveLength(2)
  })
})
