import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  agentCommandProblems, agentInstallArgs, agentInstallCommand, agentLoginCommand, agentSlug, defaultAgentCommandOptions,
  shellArg, shellPath,
} from '../../app/utils/agentCommand'

const run = promisify(execFile)
const site = 'https://example.org/kanso'
const board = '11111111-2222-3333-4444-555555555555'

/** What sh makes of a command line: its words. */
async function words(command: string): Promise<string[]> {
  const { stdout } = await run('sh', ['-c', `set -- ${command}; for a; do printf '%s\\0' "$a"; done`], { env: { HOME: '/home/u', PATH: process.env.PATH! } })
  return stdout.split('\0').slice(0, -1)
}

describe('shellArg', () => {
  it('leaves safe words bare and quotes the rest so sh reads them back unchanged', async () => {
    expect(shellArg('--board')).toBe('--board')
    expect(shellArg('https://x.org/a,b')).toBe('https://x.org/a,b')
    expect(shellArg('')).toBe(`''`)
    const tricky = [`it's`, 'a b', '$HOME `id` "x" \\ ; | & * ?', 'line\nbreak', '~/repo', '!']
    expect(await words(tricky.map(shellArg).join(' '))).toEqual(tricky)
  })

  it('keeps ~/ expandable in paths', async () => {
    expect(shellPath('~/my repo')).toBe(`~/'my repo'`)
    expect(await words(shellPath('~/my repo'))).toEqual(['/home/u/my repo'])
    expect(shellPath('~')).toBe(`'~'`)
  })
})

describe('agentSlug', () => {
  it('makes a profile and service name from the bot name', () => {
    expect(agentSlug('Claude (TR)')).toBe('claude-tr')
    expect(agentSlug('Jürgen´s Bot')).toBe('jurgen-s-bot')
    expect(agentSlug('***')).toBe('agent')
    expect(agentSlug('x'.repeat(60))).toHaveLength(40)
  })
})

describe('agent commands', () => {
  it('logs in with a profile, asking for the token unless given', () => {
    expect(agentLoginCommand(site, 'claude-tr')).toBe('kanso login --profile claude-tr --url https://example.org/kanso')
    expect(agentLoginCommand(site, 'p', 'kb_abc-_1')).toBe('kanso login --profile p --url https://example.org/kanso --token kb_abc-_1')
  })

  it('follows the board\'s agent rules by default', () => {
    const o = defaultAgentCommandOptions(site, 'Claude (TR)', board)
    expect(agentCommandProblems(o)).toEqual([])
    expect(agentInstallCommand(o)).toBe(`kanso agent install --profile claude-tr --name claude-tr --board ${board} --claude`)
  })

  it('leaves prompt and comment out in rules mode', () => {
    const o = { ...defaultAgentCommandOptions(site, 'Bot', board), prompt: 'Do it', comment: 'always' as const }
    expect(agentInstallArgs(o)).not.toContain('--prompt')
    expect(agentInstallArgs(o)).not.toContain('--comment')
  })

  it('builds every option for cards landing in columns', async () => {
    const o = {
      ...defaultAgentCommandOptions(site, 'Bot', board), trigger: 'activity' as const, columnIds: ['c1', 'c2'], activity: ['created', 'moved'],
      permissionMode: 'acceptEdits' as const, worktree: '~/code/my app', setup: 'pnpm install', logTime: true, prompt: `Fix what's asked`,
      concurrency: 2, timeout: 30, comment: 'failure' as const, workdir: '/srv/agent', name: '',
    }
    expect(agentCommandProblems(o)).toEqual([])
    const command = agentInstallCommand(o)
    expect(await words(command)).toEqual([
      'kanso', 'agent', 'install', '--profile', 'bot', '--workdir', '/srv/agent', '--board', board,
      '--activity', 'created,moved', '--columns', 'c1,c2', '--claude', '--prompt', `Fix what's asked`, '--permission-mode', 'acceptEdits',
      '--worktree', '/home/u/code/my app', '--setup', 'pnpm install', '--log-time', '--concurrency', '2', '--comment', 'failure', '--timeout', '30',
    ])
  })

  it('runs a custom command for notifications, without a board', () => {
    const o = { ...defaultAgentCommandOptions(site, 'Bot', null), runner: 'cmd' as const, cmd: './handle.sh "$KANSO_CARD_ID"', setup: 'ignored', comment: 'never' as const }
    expect(o.trigger).toBe('notifications')
    expect(agentInstallCommand(o)).toBe(`kanso agent install --profile bot --name bot --notifications --cmd './handle.sh "$KANSO_CARD_ID"'`)
  })

  it('names what is missing or wrong', () => {
    const o = defaultAgentCommandOptions(site, 'Bot', null)
    expect(agentCommandProblems({ ...o, trigger: 'rules' })).toEqual(['board'])
    expect(agentCommandProblems({ ...o, boardId: board, trigger: 'activity' })).toEqual(['activity'])
    expect(agentCommandProblems({ ...o, runner: 'cmd', cmd: ' ' })).toEqual(['cmd'])
    expect(agentCommandProblems({ ...o, profile: 'a b', name: '-x', concurrency: 33, timeout: 0 })).toEqual(['profile', 'name', 'concurrency', 'timeout'])
  })
})
