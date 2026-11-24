import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CardContext } from '../../../cli/src/agent'
import {
  cardBranch, cardSlug, claudeArgs, downloadAttachments, type Git, localDate, prepareWorktree, timeEntry, workSection,
} from '../../../cli/src/claudeWork'
import { fileExists } from '../../../cli/src/agentInstall'

const git: Git = args => new Promise(done => execFile('git', args, (err, stdout, stderr) =>
  done({ code: err ? (err as { code?: number }).code ?? 1 : 0, stdout, stderr })))

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kanso-work-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function repo() {
  const r = join(dir, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', r])
  execFileSync('git', ['-C', r, '-c', 'user.email=t@k.test', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init'])
  return r
}

const CARD = 'abcdef12-0000-4000-8000-000000000001'

describe('kanso agent --claude work setup', () => {
  it('names card branches from the title', () => {
    expect(cardSlug('Fix the Login page!')).toBe('fix-the-login-page')
    expect(cardSlug('Größe ändern – café')).toBe('gro-e-andern-cafe')
    expect(cardSlug('x'.repeat(30) + ' ' + 'y'.repeat(30))).toBe('x'.repeat(30) + '-' + 'y'.repeat(9))
    expect(cardBranch(CARD, '!!!')).toBe('card/abcdef12-work')
  })

  it('creates the card worktree, then reuses it, also as a branch after a title change', async () => {
    const r = repo()
    const first = await prepareWorktree(r, CARD, 'First title', git, fileExists)
    const wt = join(r, '.claude', 'worktrees', 'card-abcdef12')
    expect(first).toEqual({ repo: r, dir: wt, branch: 'card/abcdef12-first-title', base: 'main', reused: false })
    expect((await stat(join(wt, '.git'))).isFile()).toBe(true)
    // From inside the worktree too: the repository is the main checkout.
    expect(await prepareWorktree(wt, CARD, 'Renamed', git, fileExists)).toEqual({ ...first, reused: true })
    // Worktree removed by hand (stale entry), title changed: the branch is reused in a new worktree.
    await rm(wt, { recursive: true, force: true })
    expect(await prepareWorktree(r, CARD, 'Renamed', git, fileExists)).toEqual({ ...first, reused: true })
    await expect(prepareWorktree(dir, CARD, 'x', git, fileExists)).rejects.toThrow(`${dir} is not a git repository`)
  })

  it('downloads attachments, leaving out ones that fail', async () => {
    const target = join(dir, 'att')
    const errors: string[] = []
    const files = await downloadAttachments([
      { id: 'aaaaaaaa-1', name: 'a b/c.png', contentType: 'image/png' },
      { id: 'bbbbbbbb-2', name: 'gone.txt', contentType: 'text/plain' },
    ], target, async (path) => {
      if (path.includes('bbbbbbbb')) throw new Error('404')
      return new TextEncoder().encode(path)
    }, (a, err) => errors.push(`${a.name}: ${err.message}`))
    expect(files.map(f => f.path)).toEqual([join(target, 'aaaaaaaa-a_b_c.png')])
    expect(await readFile(files[0]!.path, 'utf8')).toBe('/api/attachments/aaaaaaaa-1')
    expect(errors).toEqual(['gone.txt: 404'])
    // Emptied for the next run; nothing left without attachments.
    expect(await downloadAttachments([], target, async () => new Uint8Array(), () => {})).toEqual([])
    await expect(readdir(target)).rejects.toThrow()
  })

  it('builds the prompt section, the claude arguments and the time entry', () => {
    const wt = { repo: '/r', dir: '/r/.claude/worktrees/card-abcdef12', branch: 'card/abcdef12-x', base: 'main', reused: true }
    const text = workSection(wt, [{ path: '/t/a.png', attachment: { id: 'a1', name: 'a.png', contentType: 'image/png' } }])
    expect(text).toContain('on branch card/abcdef12-x (started from main)')
    expect(text).toContain('`git log main..HEAD`')
    expect(text).toContain('- /t/a.png (image/png; attachment:a1, "a.png")')
    expect(workSection(null, [])).toBe('')
    expect(claudeArgs('P', '/m.json')).toEqual(['-p', 'P', '--mcp-config', '/m.json', '--strict-mcp-config', '--allowedTools', 'mcp__kanso'])
    expect(claudeArgs('P', '/m.json', 'auto')).toEqual(['-p', 'P', '--mcp-config', '/m.json', '--strict-mcp-config', '--permission-mode', 'auto'])
    const ctx = { event: { kind: 'moved' }, rule: { id: 'r', name: 'Work', instructions: '' } } as unknown as CardContext
    expect(timeEntry(ctx, 61_000, '2026-11-24', 'exit 0')).toEqual({ minutes: 2, spentOn: '2026-11-24', note: 'kanso agent: agent rule "Work" (exit 0)' })
    expect(timeEntry({ ...ctx, rule: undefined }, 0, '2026-11-24', 'failed').minutes).toBe(1)
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
