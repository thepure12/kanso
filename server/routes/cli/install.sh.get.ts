// curl -fsSL <site>/cli/install.sh | sh: installs the CLI this server serves (cli/kanso.mjs.get.ts).
export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'content-type': 'text/x-shellscript; charset=utf-8',
    // Built from the request's host without NUXT_PUBLIC_SITE_URL: never shared by caches.
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  return cliInstallScript(cliSiteUrl(event))
})
