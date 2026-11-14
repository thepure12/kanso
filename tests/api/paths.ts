import { fileURLToPath } from 'node:url'

export const rootDir = fileURLToPath(new URL('../..', import.meta.url))
/** One fixed build directory for the api tests, replaced on every run. */
export const apiBuildDir = fileURLToPath(new URL('../../.nuxt/test/api', import.meta.url))
export const apiOutputDir = `${apiBuildDir}/output`
