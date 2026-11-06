// Sub-path deployments (https://host/kanso/): set NUXT_APP_BASE_URL=/kanso/ at build
// time (in .env, or as the Docker build arg). Nuxt routes, $fetch and assets follow it;
// app/utils/basePath.ts and server/utils/basePath.ts cover the hand-built URLs.
const baseURL = `/${(process.env.NUXT_APP_BASE_URL ?? '').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/')

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@nuxt/ui', 'nuxt-auth-utils', '@nuxtjs/i18n', '@vite-pwa/nuxt'],
  app: {
    baseURL,
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: `${baseURL}favicon.svg` },
        { rel: 'apple-touch-icon', href: `${baseURL}apple-touch-icon-180x180.png` },
      ],
      meta: [
        { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#ffffff' },
        { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#18181b' },
      ],
    },
  },
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  vite: {
    server: {
      allowedHosts: ['renningert-framework-lan.dm.org', 'renningert-framework-wlan.dm.org'],
    },
  },
  nitro: {
    experimental: { tasks: true },
    // Daily email digest (server/tasks/notifications/digest.ts), server time;
    // recurring cards (server/tasks/cards/recurring.ts); webhook retries (server/tasks/webhooks/deliver.ts).
    scheduledTasks: { '0 7 * * *': ['notifications:digest'], '*/15 * * * *': ['cards:recurring'], '* * * * *': ['webhooks:deliver'] },
  },
  // UI text lives in i18n/locales/<code>.json (lazy-loaded). No URL prefixes: the
  // locale comes from the user's saved preference (users.locale, applied by the
  // default layout), else the cookie, else the browser. Server text (mails,
  // webhooks) reads the same files through server/utils/i18n.ts.
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'de', language: 'de-DE', name: 'Deutsch', file: 'de.json' },
    ],
    detectBrowserLanguage: { useCookie: true, cookieKey: 'i18n_locale', fallbackLocale: 'en' },
  },
  // Installable app with an offline copy (production builds only; devOptions off).
  // The service worker precaches the static build and keeps NetworkFirst copies of
  // pages and of the board/card/me API reads, so boards and cards opened before stay
  // viewable offline. Those two caches hold one user's data: app/plugins/cacheOwner.client.ts
  // clears them on sign-out and user change. Auth routes, SSE streams, attachments
  // and non-GET requests are never cached.
  pwa: {
    registerType: 'prompt',
    registerWebManifestInRouteRules: true,
    client: { installPrompt: true, periodicSyncForUpdates: 3600 },
    manifest: {
      name: 'Kanso',
      short_name: 'Kanso',
      description: 'Shared kanban boards',
      lang: 'en',
      start_url: baseURL,
      scope: baseURL,
      display: 'standalone',
      theme_color: '#ffffff',
      background_color: '#ffffff',
      icons: [
        { src: `${baseURL}pwa-192x192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${baseURL}pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
        { src: `${baseURL}maskable-icon-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: `${baseURL}maskable-icon-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // Server-rendered app: no HTML app shell to fall back to; pages are cached below.
      navigateFallback: null,
      globPatterns: ['**/*.{js,css,svg,png,ico,woff,woff2}'],
      cleanupOutdatedCaches: true,
      // Cache names must match app/utils/pwaCache.ts (userCacheNames). The patterns are
      // serialised into sw.js and cannot see baseURL: they match the path below the
      // service worker's scope (the base path), so they work at the root and under it.
      runtimeCaching: [
        {
          // Page loads, except sign-in/sign-up/reset pages and /auth/* (OAuth, email links).
          urlPattern: ({ request, url, sameOrigin }) => sameOrigin && request.mode === 'navigate'
            && !/^\/(?:auth|api|login|register|forgot-password|reset-password)(?:\/|$)/
              .test(url.pathname.slice(new URL((self as unknown as { registration: { scope: string } }).registration.scope).pathname.length - 1)),
          handler: 'NetworkFirst',
          options: { cacheName: 'kanso-pages', networkTimeoutSeconds: 3, cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 50 } },
        },
        {
          // GET /api/me, /api/my-work, /api/boards, /api/boards/:id, /api/cards/:id (not their sub-routes or event streams).
          urlPattern: ({ url, sameOrigin }) => sameOrigin
            && /^\/api\/(?:me|my-work|boards|boards\/[0-9a-f-]{36}|cards\/[0-9a-f-]{36})$/
              .test(url.pathname.slice(new URL((self as unknown as { registration: { scope: string } }).registration.scope).pathname.length - 1)),
          handler: 'NetworkFirst',
          method: 'GET',
          options: { cacheName: 'kanso-api', networkTimeoutSeconds: 3, cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 200 } },
        },
        {
          // Icons served by @nuxt/icon (same for every user).
          urlPattern: ({ url, sameOrigin }) => sameOrigin
            && url.pathname.slice(new URL((self as unknown as { registration: { scope: string } }).registration.scope).pathname.length - 1).startsWith('/api/_nuxt_icon/'),
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'kanso-icons', cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 50 } },
        },
      ],
    },
    devOptions: { enabled: false },
  },
  runtimeConfig: {
    databaseUrl: '',
    authDatabaseUrl: '',
    // The instance admin. Can always sign up and becomes admin once the email is
    // verified; then edits sign-up settings and manages users at /admin.
    adminEmail: '',
    // Key for TOTP secrets at rest (NUXT_TOTP_KEY, 32+ characters). Empty: derived
    // from the session password. Changing either makes stored secrets unreadable.
    totpKey: '',
    // SMTP connection URL for sign-up confirmation emails, e.g. smtps://user:pass@host:465.
    // With no SMTP URL, logLinks prints the link to the console instead (default in dev).
    // NUXT_WEBHOOK_ALLOW_PRIVATE=true lets webhooks reach loopback and private
    // addresses. For development and tests only: it opens the server to SSRF.
    webhook: { allowPrivate: false },
    mail: { smtpUrl: '', from: '', logLinks: process.env.NODE_ENV !== 'production' },
    public: {
      // Base URL for links in emails, e.g. https://kanban.example.com. Required in production.
      siteUrl: '',
    },
    // Browsers drop Secure cookies over plain http on hosts other than localhost (LAN dev access).
    // Under a base path the cookie is scoped to it and renamed, so another Nuxt app on
    // the same host (default name nuxt-session) neither sees nor overwrites it.
    session: {
      ...(baseURL === '/' ? {} : { name: 'kanso-session' }),
      cookie: { secure: process.env.NODE_ENV === 'production', path: baseURL.replace(/(.)\/$/, '$1') },
    },
  },
})
