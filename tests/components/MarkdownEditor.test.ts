import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import MarkdownEditor from '~/components/MarkdownEditor.vue'
import type { Member } from '#shared/types/board'

const greg: Member = { userId: '4385ab65-48dd-4b89-a114-69fc47d07513', name: 'Greg Beeley', email: 'greg@example.com', avatarUrl: null, role: 'editor' } as Member

describe('MarkdownEditor', () => {
  it('replaces the typed @query with one mention token', async () => {
    let value = 'Hi '
    const w = await mountSuspended(MarkdownEditor, {
      props: { 'modelValue': value, 'members': [greg], 'onUpdate:modelValue': (v: string) => { value = v; w.setProps({ modelValue: v }) } },
    })
    const el = w.find('textarea')
    for (const text of ['Hi @', 'Hi @G', 'Hi @Gr']) {
      ;(el.element as HTMLTextAreaElement).value = text
      ;(el.element as HTMLTextAreaElement).setSelectionRange(text.length, text.length)
      await el.trigger('input')
    }
    await w.find('[role="option"]').trigger('mousedown')
    expect(value).toBe(`Hi @[Greg Beeley](user:${greg.userId}) `)
  })

  it('opens on Preview with previewWhenFilled unless the text is empty', async () => {
    const filled = await mountSuspended(MarkdownEditor, { props: { modelValue: 'Some **text**', previewWhenFilled: true } })
    expect(filled.find('textarea').exists()).toBe(false)
    expect(filled.html()).toContain('<strong>text</strong>')
    const empty = await mountSuspended(MarkdownEditor, { props: { modelValue: '  ', previewWhenFilled: true } })
    expect(empty.find('textarea').exists()).toBe(true)
    const plain = await mountSuspended(MarkdownEditor, { props: { modelValue: 'Some text' } })
    expect(plain.find('textarea').exists()).toBe(true)
  })
})
