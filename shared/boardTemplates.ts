/**
 * Starting columns and tags for a new board. The new-board dialog shows
 * `boardTemplates.<key>.label/description` from i18n; label and description
 * here are the English text. Column and tag names are data and stay English.
 */
export interface BoardTemplate {
  key: string
  label: string
  description: string
  columns: { title: string, color?: string, wipLimit?: number }[]
  tags: { name: string, color: string }[]
}

export const boardTemplates: BoardTemplate[] = [
  {
    key: 'basic',
    label: 'Basic',
    description: 'To do, In progress, Done',
    columns: [{ title: 'To do' }, { title: 'In progress' }, { title: 'Done' }],
    tags: [],
  },
  {
    key: 'scrum',
    label: 'Scrum',
    description: 'Backlog through review, with story tags',
    columns: [
      { title: 'Backlog' },
      { title: 'Sprint' },
      { title: 'In progress', color: '#3b82f6', wipLimit: 5 },
      { title: 'Review', color: '#8b5cf6', wipLimit: 3 },
      { title: 'Done', color: '#22c55e' },
    ],
    tags: [{ name: 'story', color: '#3b82f6' }, { name: 'bug', color: '#ef4444' }, { name: 'chore', color: '#64748b' }],
  },
  {
    key: 'bugs',
    label: 'Bug tracking',
    description: 'Triage, fix, verify',
    columns: [
      { title: 'Reported' },
      { title: 'Triaged' },
      { title: 'Fixing', color: '#f97316', wipLimit: 5 },
      { title: 'Verifying', color: '#eab308' },
      { title: 'Closed', color: '#22c55e' },
    ],
    tags: [{ name: 'critical', color: '#ef4444' }, { name: 'regression', color: '#ec4899' }, { name: 'ui', color: '#14b8a6' }],
  },
  {
    key: 'empty',
    label: 'Empty',
    description: 'No columns',
    columns: [],
    tags: [],
  },
]
