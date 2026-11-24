import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Attachment } from '../../shared/types/board.ts'
import type { CardContext } from './agent.ts'

/** Runs a program without a shell; `code` is null when it could not be started. */
export type Git = (args: string[]) => Promise<{ code: number | null, stdout: string, stderr: string }>

/** The card's git worktree for a `--worktree` run. */
export interface CardWorktree {
  /** The repository's main checkout (top level). */
  repo: string
  dir: string
  branch: string
  /** The branch the card branch was (or would have been) started from: the main checkout's. */
  base: string
  /** An earlier run's worktree or branch was reused. */
  reused: boolean
}

/** "Fix the Login page!" → "fix-the-login-page" (at most 40 characters). */
export function cardSlug(title: string): string {
  return title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
}

/** Branch of a card: card/<first 8 of the id>-<slug>. */
export function cardBranch(cardId: string, title: string): string {
  return `card/${cardId.slice(0, 8)}-${cardSlug(title) || 'work'}`
}

async function gitOut(git: Git, args: string[], what: string): Promise<string> {
  const r = await git(args)
  if (r.code !== 0) throw new Error(`${what}: ${(r.stderr || r.stdout || 'git not found').trim()}`)
  return r.stdout.trim()
}

/**
 * Creates the card's worktree `<repo>/.claude/worktrees/card-<id8>` on branch `card/<id8>-<slug>` from the main
 * checkout's branch, or reuses it: an existing worktree as it is, an existing `card/<id8>-*` branch (also after a
 * title change) in a new worktree.
 */
export async function prepareWorktree(repoPath: string, cardId: string, title: string, git: Git, exists: (path: string) => Promise<boolean>): Promise<CardWorktree> {
  const repo = await gitOut(git, ['-C', repoPath, 'rev-parse', '--path-format=absolute', '--git-common-dir'], `${repoPath} is not a git repository`)
    .then(common => common.replace(/\/\.git\/?$/, ''))
  const base = await gitOut(git, ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], 'cannot read the main checkout\'s branch')
  const short = cardId.slice(0, 8)
  const dir = join(repo, '.claude', 'worktrees', `card-${short}`)
  if (await exists(join(dir, '.git'))) {
    const branch = await gitOut(git, ['-C', dir, 'branch', '--show-current'], `cannot read the branch of ${dir}`)
    return { repo, dir, branch: branch || 'HEAD', base, reused: true }
  }
  const existing = (await gitOut(git, ['-C', repo, 'for-each-ref', '--format=%(refname:short)', `refs/heads/card/${short}-*`], 'cannot list branches'))
    .split('\n').filter(Boolean)[0]
  // A worktree removed by hand leaves a stale entry that blocks adding it again.
  await git(['-C', repo, 'worktree', 'prune'])
  if (existing) {
    await gitOut(git, ['-C', repo, 'worktree', 'add', '--quiet', dir, existing], `cannot create the worktree ${dir}`)
    return { repo, dir, branch: existing, base, reused: true }
  }
  const branch = cardBranch(cardId, title)
  await gitOut(git, ['-C', repo, 'worktree', 'add', '--quiet', '-b', branch, dir, base], `cannot create the worktree ${dir}`)
  return { repo, dir, branch, base, reused: false }
}

/** A downloaded attachment of the card. */
export interface LocalAttachment {
  path: string
  attachment: Pick<Attachment, 'id' | 'name' | 'contentType'>
}

/** Local file name of an attachment: <id8>-<safe name>. */
export function attachmentFileName(a: Pick<Attachment, 'id' | 'name'>): string {
  return `${a.id.slice(0, 8)}-${a.name.replace(/[^\w.-]/g, '_').slice(0, 80) || 'file'}`
}

/**
 * Downloads the card's attachments into `dir` (emptied first), so Claude reads local files instead of fetching them
 * with the token. One that fails is left out and reported through `onError`.
 */
export async function downloadAttachments(
  attachments: Pick<Attachment, 'id' | 'name' | 'contentType'>[], dir: string,
  get: (path: string) => Promise<Uint8Array>, onError: (a: Pick<Attachment, 'id' | 'name'>, err: Error) => void,
): Promise<LocalAttachment[]> {
  await rm(dir, { recursive: true, force: true })
  if (!attachments.length) return []
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const out: LocalAttachment[] = []
  for (const a of attachments) {
    try {
      const path = join(dir, attachmentFileName(a))
      await writeFile(path, await get(`/api/attachments/${a.id}`), { mode: 0o600 })
      out.push({ path, attachment: a })
    } catch (err) {
      onError(a, err as Error)
    }
  }
  return out
}

/** The prompt section about the card's worktree and attachments (empty without either). */
export function workSection(wt: CardWorktree | null, files: LocalAttachment[]): string {
  const parts: string[] = []
  if (wt) {
    parts.push(`Workspace: the current directory is a git worktree of ${wt.repo} for this card, on branch ${wt.branch} (started from ${wt.base}).
${wt.reused ? `It holds earlier runs' work on this card: see \`git log ${wt.base}..HEAD\` and \`git status\`.` : 'It is new for this run.'} Later runs on this card reuse it.
Commit your work on ${wt.branch}; do not switch branches. The main checkout ${wt.repo} (branch ${wt.base}) is shared: change it only when your instructions say so.`)
  }
  if (files.length) {
    parts.push(`The card's attachments are downloaded (Markdown \`![..](attachment:<id>)\` in the card points at them). Read these local files; do not fetch them from the site:
${files.map(f => `- ${f.path} (${f.attachment.contentType}; attachment:${f.attachment.id}, "${f.attachment.name}")`).join('\n')}`)
  }
  return parts.join('\n\n')
}

/** The `claude` arguments of the --claude preset. */
export function claudeArgs(prompt: string, mcpConfig: string, permissionMode?: string): string[] {
  // --strict-mcp-config: "kanso" is this runner's token, even when the user's own config has a server of that name.
  const args = ['-p', prompt, '--mcp-config', mcpConfig, '--strict-mcp-config']
  // Without a permission mode Claude may only use the board; with one it gets its usual tools as well.
  return permissionMode ? [...args, '--permission-mode', permissionMode] : [...args, '--allowedTools', 'mcp__kanso']
}

/** Time entry for --log-time: whole minutes, rounded up, at least 1. */
export function timeEntry(context: Pick<CardContext, 'rule' | 'event'>, ms: number, startedOn: string, outcome: string) {
  const what = context.rule ? `agent rule "${context.rule.name}"` : context.event.kind
  return {
    minutes: Math.max(1, Math.ceil(ms / 60_000)),
    spentOn: startedOn,
    note: `kanso agent: ${what} (${outcome})`.slice(0, 500),
  }
}

/** YYYY-MM-DD in local time. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
