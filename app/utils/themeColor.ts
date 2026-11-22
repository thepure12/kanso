// Browser chrome colours (status bar, and on Android the navigation bar of the
// installed app) matching the page background: Nuxt UI's bg-default, white in
// light mode and zinc-900 in dark mode (app.config.ts neutral: 'zinc').
export const themeColors = { light: '#ffffff', dark: '#18181b' } as const

export type ThemeColorMeta = { name: 'theme-color', content: string, media?: string }

// <meta name="theme-color"> tags for the current colour mode. Before the mode is
// known (server render) both are sent with media queries, so the browser picks
// the system one; afterwards one tag follows the mode chosen in the app, which
// may differ from the system's.
export function themeColorMeta(mode: string | undefined, unknown: boolean): ThemeColorMeta[] {
  if (unknown || (mode !== 'light' && mode !== 'dark')) {
    return [
      { name: 'theme-color', media: '(prefers-color-scheme: light)', content: themeColors.light },
      { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: themeColors.dark },
    ]
  }
  return [{ name: 'theme-color', content: themeColors[mode] }]
}
