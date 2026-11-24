import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ColumnEditModal from '~/components/ColumnEditModal.vue'

const column = { id: 'c1', title: 'Review', description: 'Waiting for **review**', position: 1, color: null, wipLimit: 3, outline: null, rules: [] }

async function mount() {
  const w = await mountSuspended(ColumnEditModal, { attachTo: document.body, props: { open: true, column } })
  await flushPromises()
  return w
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input'))
}

describe('ColumnEditModal', () => {
  it('saves the title, description and WIP limit; a blank description clears it', async () => {
    const w = await mount()
    const title = document.body.querySelector('input:not([inputmode])') as HTMLInputElement
    expect(title.value).toBe('Review')
    setValue(title, '  Code review ')
    // The filled description opens as a preview; switch to writing.
    const write = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Write')
    write?.click()
    await flushPromises()
    const description = document.body.querySelector('textarea') as HTMLTextAreaElement
    expect(description.value).toBe('Waiting for **review**')
    setValue(description, '   ')
    await flushPromises()
    ;(document.body.querySelector('button[type="submit"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(w.emitted('save')).toEqual([[{ title: 'Code review', description: null, wipLimit: 3 }]])
    w.unmount()
  })

  it('refuses an empty title', async () => {
    const w = await mount()
    setValue(document.body.querySelector('input:not([inputmode])') as HTMLInputElement, '  ')
    await flushPromises()
    expect((document.body.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true)
    w.unmount()
  })
})
