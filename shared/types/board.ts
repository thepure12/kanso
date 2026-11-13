import type { BoardAccent } from '../boardAccents'
import type { BoardBackground } from '../boardBackgrounds'
import type { ColumnOutline } from '../columnOutline'

export type BoardRole = 'owner' | 'editor' | 'viewer'

export interface Person {
  userId: string
  name: string
  email: string
  avatarUrl: string | null
}

/** Someone with access to a board: directly, through its team, or both. */
export interface Member extends Person {
  /** Effective role: the stronger of boardRole and teamRole. */
  role: BoardRole
  boardRole: BoardRole | null
  teamRole: BoardRole | null
}

export interface TeamMember extends Person {
  role: BoardRole
}

export interface Column {
  id: string
  title: string
  position: number
  /** Heading colour as #rrggbb, or null for the default. */
  color: string | null
  /** Soft limit: the UI warns when the column holds more cards. Null = none. */
  wipLimit: number | null
  /** Frame override; null = the board's columnOutline. */
  outline: ColumnOutline | null
  rules: ColumnRule[]
}

/** Named set of a board's columns; the board view can show one group only. */
export interface ColumnGroup {
  id: string
  name: string
  /** Chip colour as #rrggbb, or null for the default. */
  color: string | null
  position: number
  /** Member columns in board order. A column can be in several groups. */
  columnIds: string[]
}

/** Automation that runs when a card enters a column (created in it or moved into it). */
export type NewColumnRule =
  | { kind: 'apply_tag', tagId: string }
  | { kind: 'remove_tag', tagId: string }
  /** Adds userId to the card's assignees. Skipped if userId has lost access to the board. */
  | { kind: 'assign_to', userId: string }
  /** Adds the person who creates the card in the column or moves it there. At most one per column. */
  | { kind: 'assign_mover' }
  /** Sets the due date to today + dueDays (0-365). At most one per column. */
  | { kind: 'set_due', dueDays: number }

export type ColumnRule = NewColumnRule & { id: string }

/**
 * POST /api/columns/:id/rules body. A new tag or assignee rule also changes the
 * cards already in the column unless applyToExisting is false (default true).
 */
export type NewColumnRuleRequest = NewColumnRule & { applyToExisting?: boolean }

/**
 * Time-based automation of a board, run hourly. "Open" cards are the ones not
 * archived and not in the last column. Changes show up in the activity log
 * with no actor and `automation: true`.
 */
export type NewBoardAutomation =
  /** Archives cards that have been in the last column for `days` days (1-365). */
  | { kind: 'archive_done', days: number }
  /** Adds tagId to open cards without activity for `days` days (1-365). */
  | { kind: 'tag_stale', days: number, tagId: string }
  /** Logs `stale` on open cards without activity for `days` days (1-365), notifying assignees and watchers. */
  | { kind: 'notify_stale', days: number }
  /** Raises open cards due within `days` days (0-365) or overdue to `priority`. */
  | { kind: 'raise_priority', days: number, priority: Priority }

export type BoardAutomationKind = NewBoardAutomation['kind']
export const boardAutomationKinds = ['archive_done', 'tag_stale', 'notify_stale', 'raise_priority'] as const satisfies readonly BoardAutomationKind[]

export type BoardAutomation = NewBoardAutomation & {
  id: string
  active: boolean
  lastRunAt: string | null
}

export interface Tag {
  id: string
  name: string
  /** #rrggbb */
  color: string
}

export const fieldKinds = ['text', 'number', 'date', 'select', 'checkbox', 'url'] as const
export type FieldKind = (typeof fieldKinds)[number]

export interface FieldOption {
  id: string
  label: string
  /** #rrggbb */
  color: string
}

/** Custom card field of a board. kind is fixed once created. */
export interface BoardField {
  id: string
  name: string
  kind: FieldKind
  /** Choices of a select field; empty for other kinds. */
  options: FieldOption[]
  position: number
  /** Show the value on board cards. */
  showOnCard: boolean
}

/**
 * A card's value for a field: text and url strings, a number, a YYYY-MM-DD
 * date, a select option id, or a checkbox boolean. See isValidFieldValue.
 */
export type FieldValue = string | number | boolean

export const priorities = ['urgent', 'high', 'medium', 'low'] as const
export type Priority = (typeof priorities)[number]

/** A card as shown on the board. Archived cards are not part of the board. */
export interface Card {
  id: string
  columnId: string
  title: string
  /** Markdown. */
  description: string
  position: number
  assigneeIds: string[]
  tagIds: string[]
  /** YYYY-MM-DD, on or before dueDate when both are set. */
  startDate: string | null
  /** YYYY-MM-DD */
  dueDate: string | null
  priority: Priority | null
  /** Story points, >= 0. */
  estimate: number | null
  /** Image attachment shown at the top of the card. */
  coverAttachmentId: string | null
  checklist: { done: number, total: number }
  commentCount: number
  attachmentCount: number
  /** Total time logged, in minutes. */
  timeMinutes: number
  /** Whether the current user watches the card. */
  watching: boolean
  /** Cards (archived ones included) with a 'blocks' link to this card. See blockedCardIds. */
  blockerIds: string[]
  /** Custom field values by field id; fields without a value have no key. */
  fields: Record<string, FieldValue>
}

/** Fields a card PATCH may change. archived moves the card to or from the archive. */
export type CardPatch = Partial<Pick<Card, 'title' | 'description' | 'assigneeIds' | 'tagIds' | 'startDate' | 'dueDate' | 'priority' | 'estimate' | 'coverAttachmentId'> & { archived: boolean }>

/**
 * One change applied to several cards at once (POST /api/boards/:id/cards/bulk).
 * columnId moves them to the end of that column, in board order; tags and
 * assignees are added or removed, not replaced.
 */
export interface BulkCardAction {
  columnId?: string
  archived?: boolean
  priority?: Priority | null
  dueDate?: string | null
  addTagIds?: string[]
  removeTagIds?: string[]
  addAssigneeIds?: string[]
  removeAssigneeIds?: string[]
}

export const recurrenceRules = ['daily', 'weekly', 'monthly'] as const
export type RecurrenceRule = (typeof recurrenceRules)[number]

/**
 * Schedule that creates a card from a template (`templateId`) in `columnId`.
 * weekly: `weekdays` (ISO, 1 = Monday) every `interval` weeks; monthly:
 * `dayOfMonth` (clamped to short months) every `interval` months.
 */
export interface CardRecurrence {
  id: string
  templateId: string
  columnId: string
  rule: RecurrenceRule
  interval: number
  weekdays: number[] | null
  dayOfMonth: number | null
  /** New cards are due this many days after they are created. */
  dueInDays: number | null
  active: boolean
  /** ISO timestamp (midnight, database time zone) of the next card. */
  nextRunAt: string
  lastRunAt: string | null
}

/** Body of PUT /api/cards/:id/recurrence. */
export type RecurrenceInput = Pick<CardRecurrence, 'columnId' | 'rule' | 'interval' | 'weekdays' | 'dayOfMonth' | 'dueInDays' | 'active'>

/** A card in a board's trash (GET /api/boards/:id/trash); purged 30 days after deletion. */
export interface TrashedCard {
  id: string
  columnId: string
  title: string
  isTemplate: boolean
  deletedAt: string
  /** Name of who deleted it; null once their account is gone. */
  deletedBy: string | null
}

export interface ArchivedCard {
  id: string
  columnId: string
  title: string
  archivedAt: string
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
  position: number
}

/** Author fields are null when the author can no longer be seen (left the board or deleted). */
export interface Comment {
  id: string
  authorId: string | null
  authorName: string | null
  authorAvatarUrl: string | null
  /** Original author's name of an imported comment (authorId is null then). */
  importedAuthor: string | null
  /** Markdown. */
  body: string
  createdAt: string
  updatedAt: string
}

export interface Attachment {
  id: string
  name: string
  contentType: string
  size: number
  uploadedBy: string | null
  createdAt: string
}

export type ActivityKind =
  | 'created' | 'moved' | 'renamed' | 'described' | 'start' | 'due' | 'priority' | 'estimate' | 'archived' | 'restored'
  | 'tagged' | 'untagged' | 'assigned' | 'unassigned' | 'commented' | 'mentioned' | 'attached' | 'detached'
  | 'linked' | 'unlinked' | 'field' | 'stale'

export interface Activity {
  id: string
  actorId: string | null
  actorName: string | null
  kind: ActivityKind
  /**
   * Kind-specific details, e.g. { from, to } for moved and renamed. commented
   * and mentioned also carry `mentions`, an array of user ids (see mentionsOf).
   * field: { field, kind, from, to } with values as text (option labels for
   * select fields, null = no value). stale: { days } (a number).
   * Activity of a board automation has no actor and `automation: true`.
   */
  data: Record<string, string | null>
  createdAt: string
}

/** Time logged on a card. userName is null when the person can no longer be seen. */
export interface TimeEntry {
  id: string
  userId: string | null
  userName: string | null
  minutes: number
  /** YYYY-MM-DD */
  spentOn: string
  note: string
  createdAt: string
}

export const cardLinkKinds = ['blocks', 'relates', 'duplicates'] as const
export type CardLinkKind = (typeof cardLinkKinds)[number]

/**
 * A link seen from one card: 'out' when this card blocks / relates to /
 * duplicates the other, 'in' when the other card does so to this one.
 */
export interface CardLink {
  id: string
  kind: CardLinkKind
  direction: 'out' | 'in'
  card: { id: string, title: string, columnId: string, columnTitle: string, archived: boolean }
}

/** Someone watching a card (people the caller can no longer see are left out). */
export interface Watcher {
  userId: string
  name: string
  avatarUrl: string | null
}

/** Everything about a card that the board does not load. */
export interface CardDetail {
  checklist: ChecklistItem[]
  comments: Comment[]
  attachments: Attachment[]
  activity: Activity[]
  /** Newest first. */
  timeEntries: TimeEntry[]
  /** Sum of timeEntries, in minutes. */
  timeTotal: number
  watchers: Watcher[]
  /** Whether the current user watches the card. */
  watching: boolean
  /** Outgoing and incoming links, oldest first. */
  links: CardLink[]
  /** Custom field values by field id, as on Card. */
  fields: Record<string, FieldValue>
}

export interface BoardDetail {
  id: string
  name: string
  background: BoardBackground | null
  /** Palette name replacing the primary colour on the board; null = app default. */
  accent: BoardAccent | null
  /** Colour, thickness and glow of the column frames; null = default ring. */
  columnOutline: ColumnOutline | null
  role: BoardRole
  /** Set while the board is archived: read-only for everyone until an owner unarchives it. */
  archivedAt: string | null
  /** Whether the current user starred the board. */
  starred: boolean
  team: { id: string, name: string } | null
  columns: Column[]
  /** Column groups in position order. */
  columnGroups: ColumnGroup[]
  /** Unarchived cards; templates are not among them. */
  cards: Card[]
  /** Card templates (each in its default column), in title order. */
  templates: Card[]
  /** Recurring card schedules, at most one per template. */
  recurrences: CardRecurrence[]
  /** Time-based automations in creation order. */
  automations: BoardAutomation[]
  tags: Tag[]
  /** Custom fields in position order. */
  fields: BoardField[]
  members: Member[]
  invites: Invite[]
}

export interface BoardSummary {
  id: string
  name: string
  teamId: string | null
  role: BoardRole
  memberCount: number
  /** Whether the current user starred the board. */
  starred: boolean
  archivedAt: string | null
  background: BoardBackground | null
  accent: BoardAccent | null
}

export interface TeamSummary {
  id: string
  name: string
  role: BoardRole
  members: TeamMember[]
  invites: Invite[]
}

/** GET /api/teams/:id: a team with its boards. */
export interface TeamDetail extends TeamSummary {
  boards: BoardSummary[]
}

/** An entry of a board's activity feed: card activity with the card's title. */
export interface BoardActivity extends Activity {
  cardId: string
  cardTitle: string
}

/** A page of the board activity feed, newest first. nextCursor is null on the last page. */
export interface BoardActivityPage {
  items: BoardActivity[]
  nextCursor: string | null
}

/** Pending membership for an email that has no account yet. */
export interface Invite {
  id: string
  email: string
  role: BoardRole
  createdAt: string
}
