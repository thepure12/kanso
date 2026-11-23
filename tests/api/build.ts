// Global setup of the api project: builds the app once per run, before any test
// file starts. Each file then only starts its own server from this build
// (`setupApi`), instead of running a full Nuxt build of its own.
import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { buildNuxt, loadNuxt, logger } from 'nuxt/kit'
import { apiBuildDir, apiOutputDir, rootDir } from './paths'

export default async function () {
  // The server bundles cli/dist (GET /cli/kanso.mjs), so the CLI is built first, as by `pnpm build`.
  execFileSync('pnpm', ['--filter', 'kanso-cli', 'build'], { cwd: rootDir, stdio: 'ignore' })
  await rm(apiBuildDir, { recursive: true, force: true })
  const nuxt = await loadNuxt({
    cwd: rootDir,
    dev: false,
    overrides: { buildDir: apiBuildDir, nitro: { output: { dir: apiOutputDir } } },
  }).finally(() => logger.restoreAll())
  try {
    await buildNuxt(nuxt)
  }
  finally {
    await nuxt.close()
    // Nuxt wraps the console; without this the test reporter prints nothing.
    logger.restoreAll()
  }
}
