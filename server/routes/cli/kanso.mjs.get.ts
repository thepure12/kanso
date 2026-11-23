// The kanso CLI (cli/, one ESM file) built with this server, so its version always matches.
// nuxt.config.ts bundles cli/dist as the `cli` server assets; `pnpm build` builds it first.
export default defineEventHandler(async (event) => {
  const file = await useStorage('assets:cli').getItemRaw<Buffer | Uint8Array | string>('kanso.mjs')
  if (!file) throw createError({ statusCode: 404, statusMessage: 'The CLI is not built (pnpm --filter kanso-cli build)' })
  setResponseHeaders(event, {
    'content-type': 'text/javascript; charset=utf-8',
    'content-disposition': 'attachment; filename="kanso.mjs"',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  })
  return typeof file === 'string' ? file : Buffer.from(file)
})
