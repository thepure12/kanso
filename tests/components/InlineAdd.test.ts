import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import InlineAdd from '~/components/InlineAdd.vue'

describe('InlineAdd', () => {
  it('uses a wrapping textarea, adds on Enter and turns line breaks into spaces', async () => {
    const w = await mountSuspended(InlineAdd, { props: { label: 'Add card', placeholder: 'Title' } })
    await w.find('button').trigger('click')
    const area = w.find('textarea')
    expect(area.exists()).toBe(true)
    await area.setValue('A long\ntitle')
    expect((area.element as HTMLTextAreaElement).value).toBe('A long title')
    await area.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('add')).toEqual([['A long title']])
    expect((area.element as HTMLTextAreaElement).value).toBe('')
  })
})
