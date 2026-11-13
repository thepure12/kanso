import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { resolveAttachmentLinks } from './attachmentLinks'
import { renderMentions } from './mentions'

let hooked = false

/**
 * Markdown to sanitized HTML, with @mentions as chips and `attachment:<id>` links pointing at
 * `<base>/api/attachments/<id>`. Browser only: DOMPurify needs a DOM.
 */
export function renderMarkdown(text: string, base = ''): string {
  if (!hooked) {
    hooked = true
    // Links open in a new tab without access to this page.
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer nofollow')
      }
    })
  }
  return DOMPurify.sanitize(marked.parse(renderMentions(resolveAttachmentLinks(text, base)), { async: false, gfm: true, breaks: true }))
}
