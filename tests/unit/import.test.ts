import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { boardExportSchema } from '#shared/boardExport'
import { parseCsv } from '#shared/import/csv'
import { toDate } from '#shared/import/common'
import { csvToBoard } from '#shared/import/csvBoard'
import { trelloColor, trelloToBoard } from '#shared/import/trello'
import { convertImport, csvHasIssueKeys, detectImportFormat, slimTrelloExport } from '#shared/import'

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, embedded newlines and commas', () => {
    expect(parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n')).toEqual([['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2']])
  })
  it('drops a BOM, accepts CRLF and CR, skips blank lines, keeps empty cells', () => {
    expect(parseCsv('﻿a,b\r\n1,\r\n\r\n2,3\r4,5')).toEqual([['a', 'b'], ['1', ''], ['2', '3'], ['4', '5']])
  })
  it('keeps a last row without a newline and empty trailing cells', () => {
    expect(parseCsv('a,b\n1,')).toEqual([['a', 'b'], ['1', '']])
  })
  it('detects semicolon and tab delimiters from the header', () => {
    expect(parseCsv('a;b\n"1;2";3')).toEqual([['a', 'b'], ['1;2', '3']])
    expect(parseCsv('a\tb\n1,2\t3')).toEqual([['a', 'b'], ['1,2', '3']])
  })
  it('treats quotes inside an unquoted cell literally', () => {
    expect(parseCsv('a\nsay "hi"')).toEqual([['a'], ['say "hi"']])
  })
})

describe('toDate', () => {
  it('reads common formats', () => {
    expect(toDate('2026-11-20')).toBe('2026-11-20')
    expect(toDate('2026-11-20T23:30:00.000Z')).toBe('2026-11-20')
    expect(toDate('20/Nov/26 12:00 AM')).toBe('2026-11-20')
    expect(toDate('20 November 2026')).toBe('2026-11-20')
    expect(toDate('20.11.2026')).toBe('2026-11-20')
    expect(toDate('11/20/2026')).toBe('2026-11-20')
    expect(toDate('20/11/2026')).toBe('2026-11-20')
  })
  it('rejects nonsense and impossible dates', () => {
    expect(toDate('not a date')).toBeNull()
    expect(toDate('2026-02-30')).toBeNull()
    expect(toDate('')).toBeNull()
    expect(toDate(null)).toBeNull()
  })
})

describe('trelloToBoard', () => {
  const { data, skipped } = trelloToBoard(JSON.parse(fixture('trello-board.json')))
  const parsed = boardExportSchema.parse(data)

  it('keeps open lists in order and cards in position order', () => {
    expect(parsed.name).toBe('Trello Roadmap')
    expect(parsed.columns.map(c => c.title)).toEqual(['To Do', 'Doing', 'Done'])
    expect(parsed.cards.map(c => [c.column, c.title])).toEqual([['To Do', 'Fix the login'], ['To Do', 'Second task'], ['Doing', 'Ship it']])
    expect(skipped.cards).toBe(1)
  })
  it('maps card fields, labels, members and checklists', () => {
    const card = parsed.cards[0]!
    expect(card).toMatchObject({
      description: 'Users **cannot** sign in.', startDate: '2026-11-01', dueDate: '2026-11-20', archived: false,
      tags: ['Bug', 'Green dark'], assignees: ['Alice', 'Zed Unknown'],
      checklist: [{ text: 'Reproduce', done: true }, { text: 'Fix it', done: false }, { text: 'Write a test', done: false }],
    })
    expect(parsed.cards[2]).toMatchObject({ archived: true, tags: ['Idea'] })
    expect(parsed.tags).toEqual([{ name: 'Bug', color: '#ef4444' }, { name: 'Green dark', color: '#15803d' }, { name: 'Idea', color: '#64748b' }])
  })
  it('maps custom fields and their values, skipping unsupported kinds and bad values', () => {
    expect(parsed.fields.map(f => [f.name, f.kind])).toEqual([['Notes', 'text'], ['Points', 'number'], ['Launch', 'date'], ['Reviewed', 'checkbox'], ['Size', 'select']])
    expect(parsed.fields[0]!.showOnCard).toBe(true)
    expect(parsed.fields[4]!.options).toEqual([{ label: 'Small', color: '#64748b' }, { label: 'Large', color: '#ef4444' }])
    expect(parsed.cards[0]!.fieldValues).toEqual({ Notes: 'check the logs', Points: 5, Launch: '2026-12-01', Reviewed: true, Size: 'Large' })
    expect(skipped.fields).toBe(1)
    expect(skipped.invalidValues).toBe(1)
  })
  it('counts comments and attachments', () => {
    expect(skipped.comments).toBe(2)
    expect(skipped.attachments).toBe(3)
  })
  it('numbers repeated list names', () => {
    const { data } = trelloToBoard({ name: 'x', lists: [{ id: 'a', name: 'Same' }, { id: 'b', name: 'Same', pos: 1 }], cards: [{ id: 'c', name: 'C', idList: 'b' }] })
    expect(data.columns.map(c => c.title)).toEqual(['Same', 'Same (2)'])
    expect(data.cards![0]!.column).toBe('Same (2)')
  })
  it('maps colour names', () => {
    expect(trelloColor('sky_light')).toBe('#7dd3fc')
    expect(trelloColor('mystery')).toBe('#64748b')
  })
  it('slims an export to what it reads, keeping only comment counts', () => {
    const slim = slimTrelloExport(JSON.parse(fixture('trello-board.json')))
    expect(slim.actions).toEqual([{ type: 'commentCard' }, { type: 'commentCard' }])
    expect(trelloToBoard(slim).data).toEqual(data)
  })
})

describe('csvToBoard', () => {
  const text = fixture('jira-issues.csv')

  it('converts a Jira export', () => {
    const { data, skipped, ignoredColumns } = csvToBoard(text, { name: 'Jira' })
    const parsed = boardExportSchema.parse(data)
    expect(parsed.columns.map(c => c.title)).toEqual(['In Progress', 'To Do', 'Done'])
    expect(parsed.tags.map(t => t.name)).toEqual(['backend', 'urgent', 'frontend'])
    expect(parsed.cards[0]).toMatchObject({
      column: 'In Progress', title: 'Fix login timeout', priority: 'urgent', assignees: ['Alice'], tags: ['backend', 'urgent'],
      dueDate: '2026-11-20', estimate: 5, description: 'Users get logged out.\nSteps: "open", wait',
    })
    expect(parsed.cards[1]).toMatchObject({ priority: 'low', description: 'Theme, colours', assignees: ['Zed Unknown'], estimate: 3 })
    expect(parsed.cards[3]).toMatchObject({ title: 'Investigate crash', priority: null, dueDate: null, estimate: null })
    expect(parsed.cards).toHaveLength(4)
    expect(skipped).toMatchObject({ cards: 1, invalidValues: 3 })
    expect(ignoredColumns).toEqual(['Issue id', 'Issue Type', 'Reporter', 'Created'])
  })
  it('optionally puts issue keys in titles', () => {
    expect(csvHasIssueKeys(text)).toBe(true)
    expect(csvHasIssueKeys('Title,Status\nA,B')).toBe(false)
    expect(csvToBoard(text, { name: 'Jira', issueKeys: true }).data.cards![0]!.title).toBe('KAN-1 Fix login timeout')
  })
  it('reads our own CSV export', () => {
    const csv = '﻿"Column","Title","Description","Tags","Assignees","Start date","Due date","Priority","Estimate","Archived","Checklist","Comments","Attachments","Created","Size"\r\n'
      + '"Doing","\'-5 degrees","multi\nline","bug, ui","a@x.test, b@x.test","2026-11-01","2026-11-02","high","2.5","yes","1/2","3","0","2026-10-01T00:00:00.000Z","L"\r\n'
      + '"Done","Plain","","","","","","","","no","","0","0","2026-10-01T00:00:00.000Z",""\r\n'
    const { data, skipped, ignoredColumns } = csvToBoard(csv, { name: 'Ours' })
    expect(data.columns).toEqual([{ title: 'Doing' }, { title: 'Done' }])
    expect(data.cards![0]).toMatchObject({
      column: 'Doing', title: '-5 degrees', description: 'multi\nline', tags: ['bug', 'ui'], assignees: ['a@x.test', 'b@x.test'],
      startDate: '2026-11-01', dueDate: '2026-11-02', priority: 'high', estimate: 2.5, archived: true,
    })
    expect(data.cards![1]).toMatchObject({ title: 'Plain', archived: false, priority: null, estimate: null, startDate: null })
    expect(skipped.invalidValues).toBe(0)
    expect(ignoredColumns).toEqual(['Checklist', 'Comments', 'Attachments', 'Created', 'Size'])
  })
  it('falls back to one column and requires a title column', () => {
    expect(csvToBoard('Name;Tags\nA;x;y', { name: 'n' }).data).toMatchObject({ columns: [{ title: 'To do' }], cards: [{ title: 'A', tags: ['x'] }] })
    expect(() => csvToBoard('Status\nDone', { name: 'n' })).toThrow(/Title/)
    expect(() => csvToBoard('', { name: 'n' })).toThrow(/empty/)
  })
})

describe('detectImportFormat / convertImport', () => {
  it('detects formats', () => {
    expect(detectImportFormat('a,b')).toBe('csv')
    expect(detectImportFormat({ lists: [], cards: [] })).toBe('trello')
    expect(detectImportFormat({ name: 'x', columns: [], cards: [] })).toBe('kanban')
  })
  it('explains a file that is not what was chosen', () => {
    expect(() => convertImport('trello', { name: 'x' }, { name: 'x' })).toThrow(/not a Trello board export \(lists/)
    expect(() => convertImport('csv', {}, { name: 'x' })).toThrow(/as text/)
  })
})
