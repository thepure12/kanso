/**
 * An absolute app path ('/login') with the base path in front ('/kanso/login' for
 * NUXT_APP_BASE_URL=/kanso/), for server redirects. Route matching and
 * event.context.matchedRoute stay relative to the base path.
 */
export function appPath(path: string): string {
  return useRuntimeConfig().app.baseURL.replace(/\/+$/, '') + path
}

/**
 * OAuth callback URL from NUXT_PUBLIC_SITE_URL (e.g. https://host/kanso/auth/github),
 * or undefined to let nuxt-auth-utils derive it from the request. Behind a reverse
 * proxy the request looks like plain http, so production needs the configured one.
 */
export function oauthRedirectURL(provider: string): string | undefined {
  const site = useRuntimeConfig().public.siteUrl
  return site ? `${site.replace(/\/+$/, '')}/auth/${provider}` : undefined
}
