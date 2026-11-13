/**
 * Reactive `matchMedia`. False during SSR and hydration, so markup renders for
 * desktop first; prefer Tailwind variants (`sm:`, `pointer-coarse:`) where CSS can do it.
 */
export function useMediaMatch(query: string) {
  const matches = ref(false)
  if (import.meta.client) {
    onMounted(() => {
      const mql = window.matchMedia(query)
      matches.value = mql.matches
      const onChange = (e: MediaQueryListEvent) => { matches.value = e.matches }
      mql.addEventListener('change', onChange)
      onBeforeUnmount(() => mql.removeEventListener('change', onChange))
    })
  }
  return matches
}

/** Phone-sized viewport (below Tailwind `sm`). */
export const useIsMobile = () => useMediaMatch('(max-width: 639px)')

/** Touch screen as the primary pointer. */
export const useCoarsePointer = () => useMediaMatch('(pointer: coarse)')
