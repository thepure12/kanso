import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import BoardGrid from '~/components/BoardGrid.vue'
import type { BoardSummary } from '#shared/types/board'

const board = (over: Partial<BoardSummary> = {}): BoardSummary => ({
  id: 'b1', name: 'Roadmap', teamId: null, role: 'owner', memberCount: 2, starred: false, archivedAt: null, ...over,
})

describe('BoardGrid', () => {
  it('emits star for the clicked board without following the link', async () => {
    const w = await mountSuspended(BoardGrid, { props: { boards: [board(), board({ id: 'b2', name: 'Ops', starred: true })] } })
    expect(w.find('[aria-label="Star board"]').exists()).toBe(true)
    await w.find('[aria-label="Unstar board"]').trigger('click')
    expect(w.emitted('star')?.[0]?.[0]).toMatchObject({ id: 'b2' })
  })

  it('marks archived boards', async () => {
    const w = await mountSuspended(BoardGrid, { props: { boards: [board({ archivedAt: '2026-10-01T00:00:00.000Z' })] } })
    expect(w.text()).toContain('Archived')
  })
})
