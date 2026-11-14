// Global setup of the api project: builds the app once per run, before any test
// file starts. Each file then only starts its own server from this build
// (`setupApi`), instead of running a full Nuxt build of its own.
import { rm } from 'node:fs/promises'
import { buildNuxt, loadNuxt, logger } from 'nuxt/kit'
import { apiBuildDir, apiOutputDir, rootDir } from './paths'

export default async function () {
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
