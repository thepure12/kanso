import type { Ref } from 'vue'

/**
 * Takes UAuthForm's show/hide password buttons out of the tab order, so Tab
 * moves from a password field straight to the next field. They stay clickable.
 */
export function useSkipPasswordToggleTab(root: Ref<HTMLElement | null>) {
  onMounted(() => {
    root.value?.querySelectorAll('[data-slot="password"] button')
      .forEach(button => button.setAttribute('tabindex', '-1'))
  })
}
