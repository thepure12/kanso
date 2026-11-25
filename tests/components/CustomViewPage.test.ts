import { clearNuxtData } from '#app'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardDetail, Card } from '#shared/types/board'
import type { CustomView, ViewColumn } from '#shared/types/customViews'
import ViewPage from '~/pages/views/[id].vue'
import CustomViewModal from '~/components/CustomViewModal.vue'

// Mounted directly, the page gets no route params.
const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
mockNuxtImport('useRoute', () => () => ({ params: { id: 'v1' }, query: route.query, path: '/views/v1' }))
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
const b1Cards = [card('c1', 'b1c1', 'Hidden one'), card('c2', 'b1c2', 'Review me')]
registerEndpoint('/api/boards/b1', () => board('b1', 'Alpha', [['b1c1', 'Todo'], ['b1c2', 'Review']], b1Cards))
let viewerOnly = false
registerEndpoint('/api/boards/b2', () => ({ ...board('b2', 'Beta', [['b2c1', 'Doing']], [card('c3', 'b2c1', 'Beta work')]), ...(viewerOnly ? { role: 'viewer' } : {}) }))
let posted: unknown
registerEndpoint('/api/boards/b1/cards', async (event) => {
  const { readBody } = await import('h3')
  const body = await readBody<{ columnId: string, title: string }>(event)
  posted = body
  const created = card('c9', body.columnId, body.title)
  b1Cards.push(created)
  return created
})

let cardPatch: unknown
registerEndpoint('/api/cards/c2', async (event) => {
  const { readBody } = await import('h3')
  cardPatch = await readBody(event)
  const target = b1Cards.find(c => c.id === 'c2')!
  target.completedAt = (cardPatch as { completed?: boolean }).completed ? '2026-11-24T00:00:00Z' : null
  return target
})

describe('custom view page', () => {
  // Each mount loads the view and its boards again; a page still mounted would keep the async data.
  let mounted: { unmount: () => void }[] = []
  const mountPage = async () => {
    const w = await mountSuspended(ViewPage)
    mounted.push(w)
    return w
  }
  beforeEach(() => clearNuxtData())
  afterEach(() => {
    for (const w of mounted) w.unmount()
    mounted = []
  })

  it('shows the chosen columns of several boards in view order, only their cards', async () => {
    const w = await mountPage()
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

  it('adds a card to a column of its board and shows it after the reload', async () => {
    const w = await mountPage()
    const section = () => w.find('[data-column-id="b1c2"]')
    await section().findAll('button').find(b => b.text() === 'Add card')!.trigger('click')
    await section().find('textarea').setValue('Fresh card')
    await section().find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))
    expect(posted).toEqual({ columnId: 'b1c2', title: 'Fresh card' })
    expect(section().text()).toContain('Fresh card')
  })

  it('marks a card complete as on the board, only where the person may edit', async () => {
    viewerOnly = true
    try {
      const w = await mountPage()
      // Viewer on Beta: no complete toggle there.
      expect(w.find('[data-column-id="b2c1"] .card-complete').exists()).toBe(false)
      const toggle = () => w.find('[data-column-id="b1c2"] .card-complete')
      expect(toggle().exists()).toBe(true)
      await toggle().trigger('click')
      await new Promise(r => setTimeout(r, 20))
      expect(cardPatch).toEqual({ completed: true })
      expect(toggle().attributes('aria-pressed')).toBe('true')
    }
    finally {
      viewerOnly = false
      b1Cards.find(c => c.id === 'c2')!.completedAt = null
    }
  })

  it('offers no add button on columns the person cannot edit', async () => {
    viewerOnly = true
    try {
      const w = await mountPage()
      expect(w.find('[data-column-id="b2c1"]').text()).not.toContain('Add card')
      expect(w.find('[data-column-id="b1c2"]').text()).toContain('Add card')
    }
    finally { viewerOnly = false }
  })

  it('shows the view columns of every board in the list view, names prefixed by their board', async () => {
    route.query = { view: 'list' }
    try {
      const w = await mountPage()
      const list = w.find('[data-testid="view-list"]')
      expect(list.exists()).toBe(true)
      expect(w.find('[data-testid="view-columns"]').exists()).toBe(false)
      expect(list.text()).toContain('Beta work')
      expect(list.text()).toContain('Review me')
      expect(list.text()).toContain('Alpha › Review')
      expect(list.text()).not.toContain('Hidden one')
    }
    finally { route.query = {} }
  })

  it('offers the calendar and timeline views', async () => {
    for (const v of ['calendar', 'timeline']) {
      route.query = { view: v }
      try {
        const w = await mountPage()
        expect(w.find(`[data-testid="view-${v}"]`).exists()).toBe(true)
        w.unmount()
        mounted = mounted.filter(m => m !== w)
      }
      finally { route.query = {} }
    }
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
  it('keeps the column search when a column is picked, so several matches can be ticked in a row', async () => {
    const w = await mountSuspended(CustomViewModal, { props: { open: true }, global: { stubs: { UModal: Overlay } } })
    const picker = w.findComponent({ name: 'USelectMenu' })
    expect(picker.exists()).toBe(true)
    expect(picker.props('resetSearchTermOnSelect')).toBe(false)
  })
})
