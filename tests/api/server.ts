import { setup } from '@nuxt/test-utils/e2e'
import { apiOutputDir, rootDir } from './paths'

/**
 * Starts this file's server from the build made by the project's global setup
 * (`build.ts`), with the file's own environment.
 */
export function setupApi(env: Record<string, string>) {
  return setup({
    rootDir,
    build: false,
    server: true,
    browser: false,
    nuxtConfig: { nitro: { output: { dir: apiOutputDir } } },
    env,
  })
}
