import { describe, expect, it } from 'vitest'
import { attachmentMarkdown, resolveAttachmentLinks } from '../../app/utils/attachmentLinks'

const id = '0b5b6c1e-6f43-4d0e-9a51-7d1f1c3c2a10'

describe('attachmentMarkdown', () => {
  it('embeds images and links other files', () => {
    expect(attachmentMarkdown({ id, name: 'shot.png', contentType: 'image/png' })).toBe(`![shot.png](attachment:${id})`)
    expect(attachmentMarkdown({ id, name: 'notes.pdf', contentType: 'application/pdf' })).toBe(`[notes.pdf](attachment:${id})`)
  })

  it('escapes brackets in the name', () => {
    expect(attachmentMarkdown({ id, name: 'a]b[c.txt', contentType: 'text/plain' })).toBe(`[a\\]b\\[c.txt](attachment:${id})`)
  })
})

describe('resolveAttachmentLinks', () => {
  it('points attachment links at the API under the base path', () => {
    expect(resolveAttachmentLinks(`see ![x](attachment:${id}) and [y](attachment:${id})`, '/kanso'))
      .toBe(`see ![x](/kanso/api/attachments/${id}) and [y](/kanso/api/attachments/${id})`)
  })

  it('leaves other links and malformed ids alone', () => {
    const text = '[a](https://example.com) [b](attachment:nope)'
    expect(resolveAttachmentLinks(text)).toBe(text)
  })
})
