import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { gitCloseActions, githubIssues, GIT_LABEL_MAX, parseGithubRepo, type GitIssue } from '#shared/gitIssues'
import type { BoardGitLink, GitSyncResult } from '#shared/types/gitLinks'

/**
 * GitHub issue import (0149/0150_git_links). Links are rows of
 * board_git_links (owners only); syncing runs as kanban_auth: claim the due
 * links, fetch their issues from GitHub, hand them to app.import_git_issues.
 */

function gitKey() {
  const config = useRuntimeConfig()
  return secretKey(config.totpKey || config.session.password, 'kanban/git-token/v1')
}

export const sealGitToken = (token: string) => sealSecret(token, gitKey())
export const openGitToken = (box: string) => openSecret(box, gitKey())

const g = schema.boardGitLinks
export const gitLinkColumns = {
  id: g.id, provider: g.provider, repo: g.repo, columnId: g.columnId, label: g.label, closeAction: g.closeAction,
  hasToken: g.hasToken, active: g.active, lastSyncedAt: g.lastSyncedAt, lastAttemptAt: g.lastAttemptAt, lastError: g.lastError, createdAt: g.createdAt,
}

type GitLinkRow = Omit<BoardGitLink, 'provider' | 'closeAction' | 'lastSyncedAt' | 'lastAttemptAt' | 'createdAt'>
  & { provider: string, closeAction: string, lastSyncedAt: Date | null, lastAttemptAt: Date | null, createdAt: Date }

export function toBoardGitLink(r: GitLinkRow): BoardGitLink {
  return {
    ...r,
    provider: 'github',
    closeAction: r.closeAction as BoardGitLink['closeAction'],
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export const gitRepoSchema = z.string().trim().max(300).transform((s, ctx) => {
  const repo = parseGithubRepo(s)
  if (!repo) {
    ctx.addIssue({ code: 'custom', message: 'Not a GitHub repository (owner/name or its URL)' })
    return z.NEVER
  }
  return repo
})
/** Blank = all issues. */
export const gitLabelSchema = z.string().trim().max(GIT_LABEL_MAX).nullish().transform(l => l || null)
export const gitCloseActionSchema = z.enum(gitCloseActions)
/** A personal access token; blank = none. */
export const gitTokenSchema = z.string().trim().max(500).nullish().transform(t => t || null)

/** NUXT_GITHUB_API_URL: GitHub's REST API (tests point it at a fake). */
function githubApiUrl(): string {
  return String(useRuntimeConfig().github.apiUrl || 'https://api.github.com').replace(/\/+$/, '')
}

/** Most pages of 100 issues read per sync. */
const MAX_PAGES = 10

/** Why GitHub refused, for the owner. */
function githubProblem(status: number | null, error: string | null, body: string | undefined): string {
  let message = ''
  try { message = String(JSON.parse(body ?? '').message ?? '') }
  catch { /* not JSON */ }
  const why = status === 401
    ? 'the access token is not valid'
    : status === 404
      ? 'repository not found, or the access token cannot read it'
      : status === 403 || status === 429
        ? 'access denied or rate limit reached (an access token raises the limit)'
        : error ?? 'request failed'
  return `GitHub: ${why}${status ? ` (HTTP ${status})` : ''}${message && status !== 404 ? `: ${message}` : ''}`
}

/**
 * The repo's issues for one sync: all open ones on the first sync (`since`
 * null), else every issue updated since then (open and closed), optionally
 * only those with `label`. Pull requests are left out.
 */
export async function fetchGithubIssues(repo: string, opts: { label: string | null, token: string | null, since: Date | null }): Promise<{ issues: GitIssue[] } | { error: string }> {
  const issues: GitIssue[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({ state: opts.since ? 'all' : 'open', per_page: '100', page: String(page), sort: 'created', direction: 'asc' })
    if (opts.label) q.set('labels', opts.label)
    if (opts.since) q.set('since', opts.since.toISOString())
    const res = await httpRequest({
      method: 'GET',
      url: `${githubApiUrl()}/repos/${repo}/issues?${q}`,
      headers: {
        'accept': 'application/vnd.github+json',
        'user-agent': 'Kanso',
        'x-github-api-version': '2022-11-28',
        ...(opts.token && { authorization: `Bearer ${opts.token}` }),
      },
      allowPrivate: webhookAllowPrivate(),
      timeoutMs: 15_000,
      maxBytes: 10 * 1024 * 1024,
    })
    if (!res.ok) return { error: githubProblem(res.status, res.error, res.body) }
    let data: unknown
    try { data = JSON.parse(res.body ?? '') }
    catch { return { error: 'GitHub: the response was not JSON' } }
    if (!Array.isArray(data)) return { error: 'GitHub: unexpected response' }
    issues.push(...githubIssues(repo, data))
    if (data.length < 100) break
  }
  return { issues }
}

type ClaimedLink = { id: string, board_id: string, provider: string, repo: string, label: string | null, token: string | null, since: string | Date | null }

/** Issues updated this long before the last sync started are fetched again (clock skew); duplicates are skipped. */
const SINCE_MARGIN_MS = 5 * 60_000

async function syncLink(link: ClaimedLink): Promise<GitSyncResult> {
  const db = useAuthDb()
  const token = link.token ? openGitToken(link.token) : null
  if (link.token && !token) {
    await db.execute(sql`select app.fail_git_link(${link.id}, ${'The stored access token cannot be read (the server key changed); enter it again'})`)
    return { imported: 0, completed: 0, error: 'The stored access token cannot be read; enter it again' }
  }
  const startedAt = new Date()
  const since = link.since ? new Date(new Date(link.since).getTime() - SINCE_MARGIN_MS) : null
  const res = await fetchGithubIssues(link.repo, { label: link.label, token, since })
  if ('error' in res) {
    await db.execute(sql`select app.fail_git_link(${link.id}, ${res.error})`)
    return { imported: 0, completed: 0, error: res.error }
  }
  try {
    const [row] = await db.execute<{ imported: number, completed: number }>(
      sql`select * from app.import_git_issues(${link.id}, ${JSON.stringify(res.issues)}::jsonb, ${startedAt.toISOString()}::timestamptz)`)
    return { imported: Number(row?.imported ?? 0), completed: Number(row?.completed ?? 0), error: null }
  }
  catch (err) {
    const message = `Import failed: ${(err as Error).message}`
    console.warn(`git link ${link.id}: ${message}`)
    await db.execute(sql`select app.fail_git_link(${link.id}, ${message})`)
    return { imported: 0, completed: 0, error: message }
  }
}

/**
 * Syncs every due link (task git:sync), or only `onlyLink` now (Sync now),
 * or only the links of `onlyBoard` (tests). Returns the result per link id.
 */
export async function syncGitLinks(opts: { onlyBoard?: string, onlyLink?: string } = {}): Promise<Map<string, GitSyncResult>> {
  const rows = await useAuthDb().execute<ClaimedLink>(
    sql`select * from app.claim_git_links(${opts.onlyBoard ?? null}::uuid, ${opts.onlyLink ?? null}::uuid)`)
  const results = new Map<string, GitSyncResult>()
  // One link at a time: GitHub rate limits are per token or per server IP.
  for (const link of rows) results.set(link.id, await syncLink(link))
  return results
}
