// Keeps a wrapping toolbar on one line by compacting it step by step.
// Sets `data-c1` ... `data-c<levels>` on the element (cumulative); children
// react with `group-data-c<n>/tb:` classes (the element carries `group/tb`).
// It refits when the element's width changes or its content changes (child
// nodes or text), always starting from the full layout. Compaction only
// touches attributes and CSS, so the observers never trigger themselves.
export function useToolbarFit(target: Readonly<Ref<HTMLElement | null | undefined>>, levels: number) {
  if (import.meta.server) return

  function apply(el: HTMLElement, n: number) {
    for (let i = 1; i <= levels; i++) el.toggleAttribute(`data-c${i}`, i <= n)
  }

  // One line = every visible child starts above the bottom of the shortest one.
  function fits(el: HTMLElement) {
    const rects = [...el.children].map(c => c.getBoundingClientRect()).filter(r => r.width || r.height)
    if (rects.length < 2) return true
    const bottom = Math.min(...rects.map(r => r.bottom))
    return rects.every(r => r.top < bottom)
  }

  function fit() {
    const el = target.value
    if (!el) return
    let n = 0
    apply(el, 0)
    while (n < levels && !fits(el)) apply(el, ++n)
  }

  let width = -1
  const resize = new ResizeObserver(([entry]) => {
    const w = Math.round(entry!.contentRect.width)
    if (w !== width) {
      width = w
      fit()
    }
  })
  const mutation = new MutationObserver(() => fit())

  watch(target, (el, old) => {
    if (old) {
      resize.unobserve(old)
      mutation.disconnect()
    }
    if (!el) return
    width = -1
    resize.observe(el)
    mutation.observe(el, { childList: true, subtree: true, characterData: true })
    fit()
  }, { immediate: true, flush: 'post' })

  onBeforeUnmount(() => {
    resize.disconnect()
    mutation.disconnect()
  })
}
