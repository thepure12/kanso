// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../app/utils/markdown'

describe('renderMarkdown', () => {
  it('renders markdown', () => {
    const html = renderMarkdown('# Title\n\n- **bold**\n- `code`')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
  })

  it('strips script, event handlers and javascript: links', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(1)">')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    const link = renderMarkdown('[x](javascript:alert(1))')
    expect(link).toContain('<a')
    expect(link).not.toContain('javascript:')
  })

  it('opens links in a new tab without opener', () => {
    const html = renderMarkdown('[site](https://example.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })

  it('renders mentions as escaped chips', () => {
    const html = renderMarkdown('hi @[Ann <b>](user:0b5b6c1e-6f43-4d0e-9a51-7d1f1c3c2a10)')
    expect(html).toContain('<span class="mention">@Ann &lt;b&gt;</span>')
    expect(html).not.toContain('user:')
  })

  it('renders pasted attachment images under the base path', () => {
    const html = renderMarkdown('![shot.png](attachment:0b5b6c1e-6f43-4d0e-9a51-7d1f1c3c2a10)', '/kanso')
    expect(html).toContain('<img src="/kanso/api/attachments/0b5b6c1e-6f43-4d0e-9a51-7d1f1c3c2a10" alt="shot.png">')
  })
})
