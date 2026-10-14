import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import ShortcutsModal from '~/components/ShortcutsModal.vue'

// Tests run in English (the default locale); this one switches to German.
describe('i18n', () => {
  afterEach(async () => {
    await useNuxtApp().$i18n.setLocale('en')
    document.body.innerHTML = ''
  })

  it('renders components in English by default', async () => {
    await mountSuspended(ShortcutsModal, { props: { open: true }, attachTo: document.body })
    expect(document.body.textContent).toContain('Keyboard shortcuts')
    expect(document.body.textContent).toContain('Filter cards')
  })

  it('renders components in German', async () => {
    await useNuxtApp().$i18n.setLocale('de')
    await mountSuspended(ShortcutsModal, { props: { open: true }, attachTo: document.body })
    expect(document.body.textContent).toContain('Tastenkürzel')
    expect(document.body.textContent).toContain('Karten filtern')
    expect(document.body.textContent).not.toContain('Filter cards')
  })
})
