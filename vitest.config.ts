import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const alias = { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) }

export default defineConfig({
  test: {
    // The db and api projects share one database: their files run one at a
    // time, and api (group 1) starts after db. unit and components run in
    // parallel with db.
    projects: [
      // RLS, triggers and SQL functions, as kanban_app / kanban_auth.
      { test: { name: 'db', include: ['tests/*.test.ts'], fileParallelism: false } },
      // Pure frontend helpers.
      { resolve: { alias }, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      // Vue components inside a Nuxt runtime.
      await defineVitestProject({
        test: {
          name: 'components',
          include: ['tests/components/**/*.test.ts'],
          setupFiles: ['tests/components/setup.ts'],
          environment: 'nuxt',
          environmentOptions: { nuxt: { rootDir, domEnvironment: 'happy-dom' } },
          // The cached transform of test-utils' app entry stub breaks the next run.
          fsModuleCache: false,
          // Starting the Nuxt app (with i18n) can take over 10 s on a cold, busy machine.
          hookTimeout: 30_000,
        },
      }),
      // HTTP API against a built server: built once by the global setup, each file starts its own.
      {
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          globalSetup: ['tests/api/build.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
