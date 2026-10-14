import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { renderMentions } from './mentions'

let hooked = false

/** Markdown to sanitized HTML, with @mentions as chips. Browser only: DOMPurify needs a DOM. */
export function renderMarkdown(text: string): string {
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
  return DOMPurify.sanitize(marked.parse(renderMentions(text), { async: false, gfm: true, breaks: true }))
}
