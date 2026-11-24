import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import type { BoardDetail, Card } from '#shared/types/board'
import type { CustomView, ViewColumn } from '#shared/types/customViews'
import ViewPage from '~/pages/views/[id].vue'
import CustomViewModal from '~/components/CustomViewModal.vue'

// Mounted directly, the page gets no route params.
mockNuxtImport('useRoute', () => () => ({ params: { id: 'v1' }, query: {}, path: '/views/v1' }))
// No event stream in tests.
mockNuxtImport('useLiveEvents', () => () => ({ subscribeBoard: () => () => {} }))

const card = (id: string, columnId: string, title: string) => ({
  id, columnId, title, description: '', position: 1, startDate: null, dueDate: null, priority: null, estimate: null,
  coverAttachmentId: null, skipAutomations: false, tagIds: [], assigneeIds: [], commentCount: 0, attachmentCount: 0,
  timeMinutes: 0, watching: false, blockerIds: [], fields: {}, checklist: { done: 0, total: 0 },
}) as unknown as Card

const board = (id: string, name: string, columns: [string, string][], cards: Card[]) => ({
  id, name, role: 'editor', columns: columns.map(([cid, title], i) => ({ id: cid, title, position: i, color: null, wipLimit: null, outline: null })),
  cards, tags: [], fields: [], members: [], buttons: [], buttonAlign: null,
}) as unknown as BoardDetail

const col = (columnId: string, boardId: string, boardName: string, title: string): ViewColumn => ({ columnId, boardId, boardName, title, color: null })
const view: CustomView = { id: 'v1', name: 'My mix', columns: [col('b2c1', 'b2', 'Beta', 'Doing'), col('b1c2', 'b1', 'Alpha', 'Review')] }

let patched: unknown
// One handler per path (a second registration replaces the first): GET, and the modal's PATCH.
registerEndpoint('/api/views/v1', async (event) => {
  if (event.method === 'PATCH') {
    const { readBody } = await import('h3')
    patched = await readBody(event)
  }
  return view
})
registerEndpoint('/api/boards/b1', () => board('b1', 'Alpha', [['b1c1', 'Todo'], ['b1c2', 'Review']], [card('c1', 'b1c1', 'Hidden one'), card('c2', 'b1c2', 'Review me')]))
registerEndpoint('/api/boards/b2', () => board('b2', 'Beta', [['b2c1', 'Doing']], [card('c3', 'b2c1', 'Beta work')]))

describe('custom view page', () => {
  it('shows the chosen columns of several boards in view order, only their cards', async () => {
    const w = await mountSuspended(ViewPage)
    const sections = w.findAll('[data-column-id]')
    expect(sections.map(s => s.attributes('data-column-id'))).toEqual(['b2c1', 'b1c2'])
    expect(sections[0]!.text()).toContain('Beta')
    expect(sections[0]!.text()).toContain('Beta work')
    expect(sections[1]!.text()).toContain('Alpha')
    expect(sections[1]!.text()).toContain('Review me')
    expect(w.text()).not.toContain('Hidden one')
    // Nothing to drag: no draggable lists.
    expect(w.find('[draggable="true"]').exists()).toBe(false)
  })
})

// The modal teleports to the body; render its body slot in place while open.
const Overlay = defineComponent({
  props: { open: Boolean, title: String },
  setup: (props, { slots }) => () => props.open ? h('div', [h('h2', props.title), slots.body?.()]) : null,
})

registerEndpoint('/api/views/columns', () => [col('b1c1', 'b1', 'Alpha', 'Todo'), ...view.columns])

describe('CustomViewModal', () => {
  it('reorders and removes columns, then saves name and order', async () => {
    const w = await mountSuspended(CustomViewModal, { props: { open: true, view }, global: { stubs: { UModal: Overlay } } })
    await new Promise(r => setTimeout(r, 0))
    const rows = () => w.findAll('[data-testid="view-columns"] li').map(li => li.text())
    expect(rows()[0]).toContain('Doing')
    await w.findAll('button[aria-label="Move down"]')[0]!.trigger('click')
    expect(rows()[0]).toContain('Review')
    await w.find('input').setValue('Renamed mix')
    await w.findAll('button[aria-label="Remove column"]')[1]!.trigger('click')
    await w.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 10))
    expect(patched).toEqual({ name: 'Renamed mix', columnIds: ['b1c2'] })
    expect(w.emitted('saved')).toHaveLength(1)
  })
})
