import { describe, expect, it } from 'vitest'
import { pastedFileName, pastedFiles } from '../../app/utils/clipboardFiles'

const now = new Date(2026, 10, 13, 15, 4, 2)
const shot = () => new File(['x'], 'image.png', { type: 'image/png' })

describe('pastedFiles', () => {
  it('ignores pastes without files', () => {
    expect(pastedFiles(null, false)).toEqual([])
    expect(pastedFiles({ files: [], types: ['text/plain'] }, false)).toEqual([])
  })

  it('names clipboard images by date and keeps copied file names', () => {
    const doc = new File(['y'], 'report.pdf', { type: 'application/pdf' })
    const out = pastedFiles({ files: [shot(), doc], types: ['Files'] }, false, now)
    expect(out.map(f => f.name)).toEqual(['pasted-2026-11-13-150402.png', 'report.pdf'])
    expect(out[0]!.type).toBe('image/png')
  })

  it('leaves text with a picture of it to a text field', () => {
    const data = { files: [shot()], types: ['text/plain', 'text/html', 'Files'] }
    expect(pastedFiles(data, true)).toEqual([])
    expect(pastedFiles(data, false, now)).toHaveLength(1)
    expect(pastedFiles({ files: [shot()], types: ['Files'] }, true, now)).toHaveLength(1)
  })
})

describe('pastedFileName', () => {
  it('takes the extension from the type when the name has none', () => {
    expect(pastedFileName(new File([''], '', { type: 'image/webp' }), now)).toBe('pasted-2026-11-13-150402.webp')
  })
})
