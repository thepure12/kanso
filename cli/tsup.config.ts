import { defineConfig } from 'tsup'

// One ESM file with a shebang: dist/kanso.mjs (the `kanso` bin). Types from
// ../shared are type-only imports, so nothing from the app is bundled.
export default defineConfig({
  entry: { kanso: 'src/index.ts' },
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node22',
  bundle: true,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
})
