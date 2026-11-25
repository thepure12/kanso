/**
 * Imports new issues of linked GitHub repositories (every 15 min,
 * nuxt.config.ts). app.claim_git_links stamps each link it hands out, so
 * several instances share the work; already imported issues are skipped.
 */
export default defineTask({
  meta: { name: 'git:sync', description: 'Import new issues of linked GitHub repositories' },
  async run() {
    const results = await syncGitLinks()
    let imported = 0
    let failed = 0
    for (const r of results.values()) {
      imported += r.imported
      if (r.error) failed++
    }
    return { result: { links: results.size, imported, failed } }
  },
})
