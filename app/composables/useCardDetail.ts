import type { Attachment, CardDetail, CardLink, CardLinkKind, ChecklistItem, Comment, TimeEntry, Watcher } from '#shared/types/board'

/**
 * Checklist, comments, attachments, time entries, watchers, links and activity of one card,
 * loaded when its dialog opens. Mutations update the local copy; on failure it reloads.
 */
export function useCardDetail(cardId: Ref<string>) {
  const showError = useApiError()
  const { t } = useI18n()
  // The board page's undo stack (absent outside a board).
  const boardUndo = inject(boardUndoKey, null)
  const detail = ref<CardDetail | null>(null)
  const loading = ref(false)

  async function load() {
    loading.value = true
    try { detail.value = await api<CardDetail>(`/api/cards/${cardId.value}`) }
    catch (err) { showError(err, t('card.errors.load')) }
    finally { loading.value = false }
  }

  async function run(fn: (d: CardDetail) => Promise<void>, title: string) {
    if (!detail.value) return
    try {
      await fn(detail.value)
      // New activity entries come from the server.
      const fresh = await api<CardDetail>(`/api/cards/${cardId.value}`)
      detail.value.activity = fresh.activity
      // Commenting watches the card (server trigger).
      detail.value.watchers = fresh.watchers
      detail.value.watching = fresh.watching
    }
    catch (err) {
      showError(err, title)
      await load()
    }
  }

  const base = () => `/api/cards/${cardId.value}`
  const retotal = (d: CardDetail) => { d.timeTotal = d.timeEntries.reduce((sum, e) => sum + e.minutes, 0) }
  // Newest day first, as the server sends them.
  const sortEntries = (d: CardDetail) => d.timeEntries.sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.createdAt.localeCompare(a.createdAt))

  return {
    detail,
    loading,
    load,

    addChecklistItem: (text: string) => run(async (d) => {
      d.checklist.push(await api<ChecklistItem>(`${base()}/checklist`, { method: 'POST', body: { text } }))
    }, t('checklist.errors.add')),

    updateChecklistItem: (item: ChecklistItem, patch: Partial<Pick<ChecklistItem, 'text' | 'done'>>) => run(async () => {
      Object.assign(item, patch)
      await api(`/api/checklist-items/${item.id}`, { method: 'PATCH', body: patch })
    }, t('checklist.errors.save')),

    /** Persists an item's new place after a drag (list already reordered). */
    checklistItemMoved: (index: number) => run(async (d) => {
      const item = d.checklist[index]!
      Object.assign(item, await api<ChecklistItem>(`/api/checklist-items/${item.id}`, {
        method: 'PATCH',
        body: { aboveId: d.checklist[index - 1]?.id ?? null, belowId: d.checklist[index + 1]?.id ?? null },
      }))
    }, t('checklist.errors.move')),

    deleteChecklistItem: (item: ChecklistItem) => run(async (d) => {
      const i = d.checklist.findIndex(x => x.id === item.id)
      const above = d.checklist[i - 1]?.id ?? null
      const below = d.checklist[i + 1]?.id ?? null
      d.checklist = d.checklist.filter(x => x.id !== item.id)
      await api(`/api/checklist-items/${item.id}`, { method: 'DELETE' })
      if (!boardUndo) return
      // Undo adds it again (a new id) between its old neighbours when they are left, else at the end.
      const card = cardId.value
      let restoredId: string
      const after = async () => {
        await boardUndo.refresh()
        if (cardId.value === card) await load()
      }
      boardUndo.record(t('checklist.deletedUndo'), async () => {
        restoredId = (await api<ChecklistItem>(`/api/cards/${card}/checklist`, { method: 'POST', body: { text: item.text } })).id
        const done = item.done ? { done: true } : {}
        const patch = (body: object) => api(`/api/checklist-items/${restoredId}`, { method: 'PATCH', body })
        // A neighbour deleted meanwhile: keep it at the end.
        try { await patch({ ...done, aboveId: above, belowId: below }) }
        catch { if (item.done) await patch(done) }
        await after()
      }, async () => {
        await api(`/api/checklist-items/${restoredId}`, { method: 'DELETE' })
        await after()
      })
    }, t('checklist.errors.delete')),

    addComment: (body: string) => run(async (d) => {
      d.comments.push(await api<Comment>(`${base()}/comments`, { method: 'POST', body: { body } }))
    }, t('comments.errors.add')),

    editComment: (comment: Comment, body: string) => run(async () => {
      Object.assign(comment, await api<Pick<Comment, 'body' | 'updatedAt'>>(`/api/comments/${comment.id}`, { method: 'PATCH', body: { body } }))
    }, t('comments.errors.save')),

    deleteComment: (comment: Comment) => run(async (d) => {
      d.comments = d.comments.filter(c => c.id !== comment.id)
      await api(`/api/comments/${comment.id}`, { method: 'DELETE' })
    }, t('comments.errors.delete')),

    /** Uploads files (at most 5 per call) and returns the new attachments, or [] on failure. */
    upload: async (files: File[]) => {
      let added: Attachment[] = []
      await run(async (d) => {
        const form = new FormData()
        for (const f of files) form.append('file', f)
        added = await api<Attachment[]>(`${base()}/attachments`, { method: 'POST', body: form })
        d.attachments.push(...added)
      }, t('attachments.errors.upload'))
      return added
    },

    deleteAttachment: (a: Attachment) => run(async (d) => {
      d.attachments = d.attachments.filter(x => x.id !== a.id)
      await api(`/api/attachments/${a.id}`, { method: 'DELETE' })
    }, t('attachments.errors.delete')),

    logTime: (entry: Pick<TimeEntry, 'minutes' | 'spentOn' | 'note'>) => run(async (d) => {
      d.timeEntries.push(await api<TimeEntry>(`${base()}/time`, { method: 'POST', body: entry }))
      sortEntries(d)
      retotal(d)
    }, t('time.errors.log')),

    updateTimeEntry: (entry: TimeEntry, patch: Partial<Pick<TimeEntry, 'minutes' | 'spentOn' | 'note'>>) => run(async (d) => {
      Object.assign(entry, patch)
      sortEntries(d)
      retotal(d)
      Object.assign(entry, await api<TimeEntry>(`/api/time-entries/${entry.id}`, { method: 'PATCH', body: patch }))
    }, t('time.errors.save')),

    /** Watches (`me` is the current user, shown at once) or stops watching the card. */
    setWatching: (watching: boolean, me: Watcher) => run(async (d) => {
      d.watching = watching
      d.watchers = watching ? [...d.watchers.filter(w => w.userId !== me.userId), me] : d.watchers.filter(w => w.userId !== me.userId)
      await api(`${base()}/watch`, { method: watching ? 'PUT' : 'DELETE' })
    }, watching ? t('card.errors.watch') : t('card.errors.unwatch')),

    /** Links this card to another one; returns the new link. */
    addLink: async (toCardId: string, kind: CardLinkKind) => {
      let created: CardLink | undefined
      await run(async (d) => {
        created = await api<CardLink>(`${base()}/links`, { method: 'POST', body: { toCardId, kind } })
        d.links.push(created)
      }, t('cardLinks.errors.add'))
      return created
    },

    deleteLink: (link: CardLink) => run(async (d) => {
      d.links = d.links.filter(l => l.id !== link.id)
      await api(`/api/card-links/${link.id}`, { method: 'DELETE' })
    }, t('cardLinks.errors.delete')),

    deleteTimeEntry: (entry: TimeEntry) => run(async (d) => {
      d.timeEntries = d.timeEntries.filter(e => e.id !== entry.id)
      retotal(d)
      await api(`/api/time-entries/${entry.id}`, { method: 'DELETE' })
    }, t('time.errors.delete')),
  }
}

export type CardDetailApi = ReturnType<typeof useCardDetail>
