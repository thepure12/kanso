import type { BoardSummary } from '../../../shared/types/board.ts'
import { fields, json, table } from '../output.ts'
import { loadBoard } from '../resolve.ts'
import { connect, positionals } from './common.ts'
import type { Command } from './types.ts'

export const boardsLs: Command = {
  name: 'boards ls',
  summary: 'List the boards you can see',
  usage: 'boards ls [--archived]',
  options: {
    archived: { type: 'boolean', description: 'Include archived boards' },
  },
  async run(ctx) {
    positionals(ctx)
    const client = await connect(ctx)
    const all = await client.get<BoardSummary[]>('/api/boards')
    const boards = all.filter(b => ctx.values.archived || b.archivedAt === null)
    if (ctx.json) {
      ctx.io.stdout(json(boards.map(b => ({ id: b.id, name: b.name, role: b.role, teamId: b.teamId, starred: b.starred, archived: b.archivedAt !== null }))))
      return
    }
    if (!boards.length) {
      ctx.io.stdout('No boards.\n')
      return
    }
    ctx.io.stdout(table(['ID', 'NAME', 'ROLE', 'STARRED', ...(ctx.values.archived ? ['ARCHIVED'] : [])],
      boards.map(b => [b.id, b.name, b.role, b.starred ? '*' : '', ...(ctx.values.archived ? [b.archivedAt ? 'archived' : ''] : [])])))
  },
}

export const boardShow: Command = {
  name: 'board show',
  summary: 'Show a board\'s columns, card tags and members',
  usage: 'board show <board>',
  details: 'A board is given by its id or name (or a unique part of the name).',
  async run(ctx) {
    const [ref] = positionals(ctx, '<board>')
    const board = await loadBoard(await connect(ctx), ref!)
    const count = (columnId: string) => board.cards.filter(c => c.columnId === columnId).length
    const view = {
      id: board.id,
      name: board.name,
      role: board.role,
      archived: board.archivedAt !== null,
      team: board.team,
      columns: board.columns.map(c => ({ id: c.id, title: c.title, cards: count(c.id), wipLimit: c.wipLimit })),
      tags: board.tags.map(t => ({ id: t.id, name: t.name, color: t.color })),
      members: board.members.map(m => ({ userId: m.userId, name: m.name, email: m.isBot ? null : m.email, role: m.role, bot: m.isBot })),
    }
    if (ctx.json) {
      ctx.io.stdout(json(view))
      return
    }
    ctx.io.stdout(fields([
      ['Board', board.name],
      ['Id', board.id],
      ['Your role', board.role],
      ['Team', board.team && (board.team.name ?? board.team.id)],
      ['Archived', view.archived],
    ]))
    ctx.io.stdout(`\nColumns:\n${table(['ID', 'TITLE', 'CARDS', 'WIP'], view.columns.map(c => [c.id, c.title, c.cards, c.wipLimit]))}`)
    ctx.io.stdout(`\nCard tags:\n${view.tags.length ? table(['ID', 'NAME'], view.tags.map(t => [t.id, t.name])) : '-\n'}`)
    ctx.io.stdout(`\nMembers:\n${table(['NAME', 'EMAIL', 'ROLE'], view.members.map(m => [m.name, m.bot ? 'bot' : m.email, m.role]))}`)
  },
}
