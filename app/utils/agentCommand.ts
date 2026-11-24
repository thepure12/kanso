// Builds the shell commands that set up a `kanso agent run` service for a bot
// (`kanso login --profile ...` and `kanso agent install ...`, see docs/CLI.md).
// Pure text: nothing runs in the browser. AgentCommandBuilder shows the result.

/** What starts a run: the board's agent rules, card activity (optionally in columns) or notifications. */
export const agentTriggers = ['rules', 'activity', 'notifications'] as const
export type AgentTrigger = (typeof agentTriggers)[number]

/** Activity kinds offered for the activity trigger (the CLI takes any; these are the useful ones). */
export const agentActivityKinds = ['created', 'moved', 'commented', 'mentioned', 'assigned', 'tagged'] as const
export type AgentActivityKind = (typeof agentActivityKinds)[number]

/** claude's --permission-mode; '' = only the board's MCP tools. */
export const agentPermissionModes = ['', 'acceptEdits', 'auto'] as const
export type AgentPermissionMode = (typeof agentPermissionModes)[number]

export const agentCommentModes = ['never', 'failure', 'always'] as const
export type AgentCommentMode = (typeof agentCommentModes)[number]

export interface AgentCommandOptions {
  /** Site URL with the base path, no trailing slash. */
  site: string
  /** `kanso login` profile holding the bot's token. */
  profile: string
  /** Service name (`--name`); '' = the default unit kanso-agent.service. */
  name: string
  boardId: string | null
  trigger: AgentTrigger
  /** activity trigger: only cards in these columns (ids). */
  columnIds: string[]
  /** activity trigger: kinds; empty = the CLI's default for columns (created, moved). */
  activity: string[]
  runner: 'claude' | 'cmd'
  cmd: string
  permissionMode: AgentPermissionMode
  /** Repository for a git worktree per card; '' = none. */
  worktree: string
  setup: string
  logTime: boolean
  /** Instructions for Claude; not with agent rules (they bring their own). */
  prompt: string
  concurrency: number
  /** Minutes; null = no limit. */
  timeout: number | null
  /** Not with agent rules (they set their own). */
  comment: AgentCommentMode
  /** Working directory of the runs; '' = where the command is run. */
  workdir: string
}

export function defaultAgentCommandOptions(site: string, botName: string, boardId: string | null): AgentCommandOptions {
  const slug = agentSlug(botName)
  return {
    site, profile: slug, name: slug, boardId, trigger: boardId ? 'rules' : 'notifications', columnIds: [], activity: [],
    runner: 'claude', cmd: '', permissionMode: '', worktree: '', setup: '', logTime: false, prompt: '',
    concurrency: 1, timeout: null, comment: 'failure', workdir: '',
  }
}

/** One shell word: left bare when it only has safe characters, else single-quoted for sh. */
export function shellArg(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

/** A path as one shell word, keeping a leading ~/ outside the quotes so the shell expands it. */
export function shellPath(value: string): string {
  return value.startsWith('~/') && value.length > 2 ? `~/${shellArg(value.slice(2))}` : shellArg(value)
}

/** A name for the profile and the service from a bot's name: "Claude (TR)" → "claude-tr". */
export function agentSlug(name: string): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return slug || 'agent'
}

/** Mirrors the CLI's checks (profileName, checkAgentName). */
export const validProfile = (p: string) => /^[\w.-]{1,64}$/.test(p)
export const validServiceName = (n: string) => n === '' || /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(n)

/** What keeps the command from working, as keys of `agentCommand.problems.*`; empty = fine. */
export function agentCommandProblems(o: AgentCommandOptions): string[] {
  const problems: string[] = []
  if (!validProfile(o.profile)) problems.push('profile')
  if (!validServiceName(o.name)) problems.push('name')
  if (o.trigger !== 'notifications' && !o.boardId) problems.push('board')
  if (o.trigger === 'activity' && !o.columnIds.length && !o.activity.length) problems.push('activity')
  if (o.runner === 'cmd' && !o.cmd.trim()) problems.push('cmd')
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1 || o.concurrency > 32) problems.push('concurrency')
  if (o.timeout !== null && !(o.timeout > 0)) problems.push('timeout')
  return problems
}

/** `kanso login` for the profile; the token is asked for (stays out of the shell history) unless given. */
export function agentLoginCommand(site: string, profile: string, token?: string | null): string {
  return ['kanso', 'login', '--profile', profile, '--url', site, ...token ? ['--token', token] : []].map(shellArg).join(' ')
}

/** The arguments after `kanso agent install`, in the order `kanso agent install` itself writes them. */
export function agentInstallArgs(o: AgentCommandOptions): string[] {
  const args = ['--profile', o.profile]
  if (o.name) args.push('--name', o.name)
  if (o.workdir.trim()) args.push('--workdir', o.workdir.trim())
  if (o.trigger !== 'notifications' && o.boardId) args.push('--board', o.boardId)
  if (o.trigger === 'activity') {
    if (o.activity.length) args.push('--activity', o.activity.join(','))
    if (o.columnIds.length) args.push('--columns', o.columnIds.join(','))
  }
  if (o.trigger === 'notifications') args.push('--notifications')
  if (o.runner === 'cmd') args.push('--cmd', o.cmd.trim())
  else {
    args.push('--claude')
    if (o.trigger !== 'rules' && o.prompt.trim()) args.push('--prompt', o.prompt.trim())
    if (o.permissionMode) args.push('--permission-mode', o.permissionMode)
    if (o.worktree.trim()) args.push('--worktree', o.worktree.trim())
    if (o.setup.trim()) args.push('--setup', o.setup.trim())
    if (o.logTime) args.push('--log-time')
  }
  if (o.concurrency !== 1) args.push('--concurrency', String(o.concurrency))
  if (o.trigger !== 'rules' && o.comment !== 'never') args.push('--comment', o.comment)
  if (o.timeout !== null) args.push('--timeout', String(o.timeout))
  return args
}

export function agentInstallCommand(o: AgentCommandOptions): string {
  const args = agentInstallArgs(o)
  const paths = new Set(['--worktree', '--workdir'])
  return ['kanso agent install', ...args.map((a, i) => paths.has(args[i - 1]!) ? shellPath(a) : shellArg(a))].join(' ')
}
