import { describe, expect, it } from 'vitest'
import { COLUMN_WIDTH_DEFAULT, COLUMN_WIDTH_MAX, COLUMN_WIDTH_MIN, clampColumnWidth, parseColumnWidths, pruneColumnWidths } from '../../app/utils/columnWidths'

describe('column widths', () => {
  it('clamps and rounds widths', () => {
    expect(clampColumnWidth(10)).toBe(COLUMN_WIDTH_MIN)
    expect(clampColumnWidth(5000)).toBe(COLUMN_WIDTH_MAX)
    expect(clampColumnWidth(300.6)).toBe(301)
    expect(clampColumnWidth(Number.NaN)).toBe(COLUMN_WIDTH_DEFAULT)
  })

  it('parses stored widths, ignoring bad data', () => {
    expect(parseColumnWidths(null)).toEqual({})
    expect(parseColumnWidths('not json')).toEqual({})
    expect(parseColumnWidths('[1,2]')).toEqual({})
    expect(parseColumnWidths('{"a":320,"b":"wide","c":9999}')).toEqual({ a: 320, c: COLUMN_WIDTH_MAX })
  })

  it('prunes unknown columns and default widths', () => {
    expect(pruneColumnWidths({ a: 320, b: COLUMN_WIDTH_DEFAULT, gone: 400 }, ['a', 'b'])).toEqual({ a: 320 })
  })
})
