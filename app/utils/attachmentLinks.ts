/**
 * Card attachments referenced from Markdown (comments, descriptions) as `attachment:<id>`,
 * so the text stays valid under any base path; `resolveAttachmentLinks` turns them into
 * app URLs right before rendering.
 */

/** The server's limit per attachment. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** `![name](attachment:id)` for images the browser shows inline, else a link. */
export function attachmentMarkdown(a: { id: string, name: string, contentType: string }): string {
  const label = a.name.replace(/[[\]\\]/g, '\\$&')
  return `${IMAGE_TYPES.includes(a.contentType) ? '!' : ''}[${label}](attachment:${a.id})`
}

const LINK = /\]\(attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi

/** Rewrites `](attachment:<id>)` to `](<base>/api/attachments/<id>)`. */
export function resolveAttachmentLinks(text: string, base = ''): string {
  return text.replace(LINK, (_, id: string) => `](${base}/api/attachments/${id.toLowerCase()})`)
}
