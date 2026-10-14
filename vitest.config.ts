import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const alias = { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) }

export default defineConfig({
  test: {
    // The db and api projects share one database; files run one at a time.
    fileParallelism: false,
    projects: [
      // RLS, triggers and SQL functions, as kanban_app / kanban_auth.
      { test: { name: 'db', include: ['tests/*.test.ts'] } },
      // Pure frontend helpers.
      { resolve: { alias }, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      // Vue components inside a Nuxt runtime.
      await defineVitestProject({
        test: {
          name: 'components',
          include: ['tests/components/**/*.test.ts'],
          environment: 'nuxt',
          environmentOptions: { nuxt: { rootDir, domEnvironment: 'happy-dom' } },
          // The cached transform of test-utils' app entry stub breaks the next run.
          fsModuleCache: false,
          // Starting the Nuxt app (with i18n) can take over 10 s on a cold, busy machine.
          hookTimeout: 30_000,
        },
      }),
      // HTTP API against a built server (built once per file, so slower).
      { test: { name: 'api', include: ['tests/api/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 300_000 } },
    ],
  },
})
