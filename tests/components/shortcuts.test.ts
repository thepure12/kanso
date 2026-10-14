import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

// The single-key shortcuts (layout and board page) rely on defineShortcuts
// ignoring keys typed into inputs, textareas and contenteditable elements.
const fired: string[] = []
const Harness = defineComponent({
  setup() {
    defineShortcuts({
      '?': () => fired.push('?'),
      'n': () => fired.push('n'),
      'g-h': () => fired.push('g-h'),
      'meta_k': { usingInput: true, handler: () => fired.push('k') },
    })
    return () => h('div', [h('input', { id: 'i' }), h('textarea', { id: 't' }), h('div', { id: 'e', contenteditable: 'true', tabindex: 0 }), h('button', { id: 'b' })])
  },
})

async function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  await nextTick()
}

describe('keyboard shortcuts', () => {
  it('fire outside text fields and not while typing, except Ctrl/Cmd+K', async () => {
    const w = await mountSuspended(Harness, { attachTo: document.body })
    const focus = async (id: string) => {
      ;(w.find(`#${id}`).element as HTMLElement).focus()
      await nextTick()
    }

    await focus('b')
    await press('?', { shiftKey: true })
    await press('g')
    await press('h')
    expect(fired).toEqual(['?', 'g-h'])

    for (const id of ['i', 't', 'e']) {
      fired.length = 0
      await focus(id)
      await press('?', { shiftKey: true })
      await press('n')
      await press('k', { ctrlKey: true }) // meta_ is Ctrl off macOS
      expect(fired, id).toEqual(['k'])
    }
    w.unmount()
  })
})
