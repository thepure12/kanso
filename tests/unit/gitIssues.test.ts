import { describe, expect, it } from 'vitest'
import { githubIssues, issueDescription, parseGithubRepo } from '../../shared/gitIssues'

describe('parseGithubRepo', () => {
  it('reads owner/name, URLs and ssh remotes, in lower case', () => {
    expect(parseGithubRepo('Acme/Widgets')).toBe('acme/widgets')
    expect(parseGithubRepo(' https://github.com/acme/widgets ')).toBe('acme/widgets')
    expect(parseGithubRepo('github.com/acme/widgets.git')).toBe('acme/widgets')
    expect(parseGithubRepo('https://www.github.com/acme/widgets/issues?q=is%3Aopen')).toBe('acme/widgets')
    expect(parseGithubRepo('git@github.com:acme/my.repo_1.git')).toBe('acme/my.repo_1')
  })

  it('refuses anything else', () => {
    for (const bad of ['', 'acme', 'acme/', '/widgets', 'https://gitlab.com/acme/widgets', 'acme/wid gets', 'acme/..', 'a/b c', 'ac$me/widgets']) {
      expect(parseGithubRepo(bad), bad).toBeNull()
    }
  })
})

describe('githubIssues', () => {
  it('maps issues, leaves out pull requests and odd entries', () => {
    const issues = githubIssues('acme/widgets', [
      { number: 1, state: 'open', title: ' Broken ', body: 'Steps', html_url: 'https://github.com/acme/widgets/issues/1', user: { login: 'dana' }, labels: [{ name: 'bug' }, 'ui', { color: 'fff' }] },
      { number: 2, state: 'open', title: 'A PR', html_url: 'https://github.com/acme/widgets/pull/2', pull_request: {} },
      { number: 3, state: 'closed', title: '', body: null, html_url: 'https://github.com/acme/widgets/issues/3', user: null },
      null,
      { title: 'no number' },
    ])
    expect(issues).toEqual([
      { number: 1, state: 'open', title: 'Broken', description: '[acme/widgets#1](https://github.com/acme/widgets/issues/1) · @dana\n\nSteps', url: 'https://github.com/acme/widgets/issues/1', labels: ['bug', 'ui'] },
      { number: 3, state: 'closed', title: '#3', description: '[acme/widgets#3](https://github.com/acme/widgets/issues/3)', url: 'https://github.com/acme/widgets/issues/3', labels: [] },
    ])
    expect(githubIssues('acme/widgets', { message: 'Not Found' })).toEqual([])
  })

  it('cuts long bodies to the card description limit', () => {
    const text = issueDescription('acme/widgets', { number: 7, url: 'https://github.com/acme/widgets/issues/7', author: null, body: 'x'.repeat(20_000) })
    expect(text).toHaveLength(10_000)
    expect(text.endsWith('…')).toBe(true)
  })
})
