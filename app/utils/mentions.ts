/**
 * @mentions in comments are stored in the Markdown body as
 * `@[Name](user:<uuid>)`; the database (app.comment_mentions) reads the ids and
 * notifies those people. The name is only for display.
 */
export const MENTION_PATTERN = /@\[([^\]]*)\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi

export function mentionToken(m: { userId: string, name: string }): string {
  return `@[${m.name.replace(/[[\]()]/g, '')}](user:${m.userId})`
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

/** Turns mention tokens into `<span class="mention">` before the Markdown is parsed. */
export function renderMentions(text: string): string {
  return text.replace(MENTION_PATTERN, (_, name: string) => `<span class="mention">@${escapeHtml(name)}</span>`)
}

/**
 * The `@query` being typed right before the caret, if any: `@` at the start or
 * after whitespace, followed by up to 30 characters without spaces.
 */
export function mentionQuery(text: string, caret: number): { start: number, query: string } | null {
  const m = /(^|\s)@([^\s@[\]()]{0,30})$/.exec(text.slice(0, caret))
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null
}
