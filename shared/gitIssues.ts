/** What happens to an imported card when its issue closes. */
export const gitCloseActions = ['none', 'complete'] as const
export type GitCloseAction = typeof gitCloseActions[number]

/** Longest label filter (check `board_git_links_label_length`). */
export const GIT_LABEL_MAX = 100

const part = /^[a-z0-9_.-]{1,100}$/

/**
 * `owner/name` (lower case, as stored) from what a person pastes: `owner/name`,
 * a github.com URL (with or without https://, `.git`, or a deeper path such as
 * `/issues`) or an ssh remote `git@github.com:owner/name.git`. Null when it is
 * none of these.
 */
export function parseGithubRepo(input: string): string | null {
  let s = input.trim()
  const ssh = /^git@github\.com:(.+)$/i.exec(s)
  if (ssh) s = ssh[1]!
  else s = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
  const [owner, rawName] = s.split(/[/?#]/)
  const name = rawName?.replace(/\.git$/i, '')
  if (!owner || !name) return null
  const repo = `${owner}/${name}`.toLowerCase()
  return part.test(owner.toLowerCase()) && part.test(name.toLowerCase()) && name !== '.' && name !== '..' ? repo : null
}

/** An issue as app.import_git_issues takes it. */
export interface GitIssue {
  number: number
  state: 'open' | 'closed'
  title: string
  description: string
  url: string
  labels: string[]
}

/** Longest card description (card PATCH). */
const DESCRIPTION_MAX = 10_000

/**
 * The card description of an issue: a link line naming the repo, number and
 * GitHub author, then the issue's Markdown body, cut to fit the card.
 */
export function issueDescription(repo: string, issue: { number: number, url: string, author: string | null, body: string | null }): string {
  const head = `[${repo}#${issue.number}](${issue.url})${issue.author ? ` · @${issue.author}` : ''}`
  const body = issue.body?.trim() ?? ''
  const text = body ? `${head}\n\n${body}` : head
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1)}…` : text
}

/**
 * The issues of one page of GitHub's `GET /repos/:owner/:repo/issues`, pull
 * requests left out (that list includes them).
 */
export function githubIssues(repo: string, page: unknown): GitIssue[] {
  if (!Array.isArray(page)) return []
  const out: GitIssue[] = []
  for (const raw of page) {
    if (!raw || typeof raw !== 'object') continue
    const i = raw as Record<string, any>
    if (i.pull_request || typeof i.number !== 'number' || typeof i.html_url !== 'string') continue
    const title = typeof i.title === 'string' && i.title.trim() ? i.title.trim() : `#${i.number}`
    out.push({
      number: i.number,
      state: i.state === 'closed' ? 'closed' : 'open',
      title: title.slice(0, 1000),
      description: issueDescription(repo, { number: i.number, url: i.html_url, author: typeof i.user?.login === 'string' ? i.user.login : null, body: typeof i.body === 'string' ? i.body : null }),
      url: i.html_url,
      labels: Array.isArray(i.labels)
        ? i.labels.map((l: unknown) => typeof l === 'string' ? l : (l as { name?: unknown })?.name).filter((n: unknown): n is string => typeof n === 'string')
        : [],
    })
  }
  return out
}
