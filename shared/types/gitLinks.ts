import type { GitCloseAction } from '../gitIssues'

/** A GitHub repository linked to a board (GET /api/boards/:id/git-links, owners only). */
export interface BoardGitLink {
  id: string
  provider: 'github'
  /** owner/name, lower case. */
  repo: string
  /** Where new issues become cards (at the end). */
  columnId: string
  /** Only issues with this label; null = all. */
  label: string | null
  closeAction: GitCloseAction
  /** Whether an access token is stored (it is never returned). */
  hasToken: boolean
  active: boolean
  lastSyncedAt: string | null
  lastAttemptAt: string | null
  /** Why the last sync failed; null after a successful one. */
  lastError: string | null
  createdAt: string
}

/** Result of POST /api/git-links/:id/sync. */
export interface GitSyncResult {
  imported: number
  completed: number
  error: string | null
}
