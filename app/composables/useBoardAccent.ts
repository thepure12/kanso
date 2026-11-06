import type { BoardAccent } from '#shared/boardAccents'

/**
 * Swaps the app's primary colour for the board's accent while the calling page
 * is mounted. Nuxt UI derives its colour variables from app config, so this
 * also reaches the header and teleported dialogs, and renders during SSR (the
 * server app config is a per-request copy).
 */
export function useBoardAccent(accent: () => BoardAccent | null | undefined) {
  const ui = useAppConfig().ui as { colors: { primary: string } }
  const fallback = ui.colors.primary
  watch(accent, (a) => { ui.colors.primary = a ?? fallback }, { immediate: true })
  onScopeDispose(() => { ui.colors.primary = fallback })
}
