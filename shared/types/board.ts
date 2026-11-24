import type { BoardAccent } from '../boardAccents'
import type { BoardBackground } from '../boardBackgrounds'
import type { ColumnOutline } from '../columnOutline'
import type { BoardNotificationLevel } from '../notificationSettings'
import type { SavedViewConfig } from '../savedViews'
import type { BoardBot } from './bots'
import type { BoardButton, ButtonAlign } from '../buttons'
import type { BoardMatrixRoom, CardMatrixThread } from './matrix'

export type BoardRole = 'owner' | 'editor' | 'commenter' | 'viewer'

export interface Person {
  userId: string
  name: string
  email: string
  avatarUrl: string | null
  /** A bot (people suggestions: the caller's own account bots). */
  isBot?: boolean
}

/** Someone with access to a board: directly, through its team, or both. */
export interface Member extends Person {
  /** Effective role: the stronger of boardRole and teamRole. */
  role: BoardRole
  boardRole: BoardRole | null
  teamRole: BoardRole | null
  /** A bot (acts through API tokens): of this board (see BoardDetail.bots), its team, or someone's account. */
  isBot: boolean
  /** A person's account bot (0109_account_bots_rls.sql): board owners change its role and remove it like a member. */
  accountBot: boolean
}

/** Access of a limited member to a card or column (0088_board_member_access_rls.sql). */
export type BoardAccess = 'none' | 'read' | 'edit'

/**
 * Limits of a non-owner on a board: a card's access is its entry in `cards`,
 * else its column's entry in `columns`, else `defaultAccess`, capped by the role
 * (viewers at most read). Limited people cannot change the board's structure.
 */
export interface MemberAccess {
  defaultAccess: BoardAccess
  /** Column id → access. */
  columns: Record<string, BoardAccess>
  /** Card id → access; wins over the card's column. */
  cards: Record<string, BoardAccess>
}

export interface TeamMember extends Person {
  role: BoardRole
  /** A team bot (0106_team_bots_rls.sql). */
  isBot?: boolean
}

export interface Column {
  id: string
  title: string
  /** What the column is for (Markdown), or null. */
  description: string | null
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
/** Named set of a board's people; assigning it adds them as assignees. */
export interface AssigneeGroup {
  id: string
  name: string
  /** Members who still have access to the board, by name. */
  userIds: string[]
}

export interface ColumnGroup {
  id: string
  name: string
  /** Chip colour as #rrggbb, or null for the default. */
  color: string | null
  position: number
  /** Member columns in board order. A column can be in several groups. */
  columnIds: string[]
}

/** Named view of a board: view, grouping, column group and filter. */
export interface SavedView {
  id: string
  name: string
  /** Shared on the board (editors manage, everyone sees); else personal. */
  shared: boolean
  config: SavedViewConfig
}

/** Automation that runs when a card enters a column (created in it or moved into it). */
export type NewColumnRule =
  | { kind: 'apply_tag', tagId: string }
  | { kind: 'remove_tag', tagId: string }
  /** Adds userId to the card's assignees. Skipped if userId has lost access to the board. */
  | { kind: 'assign_to', userId: string }
  /** Adds the person who creates the card in the column or moves it there. At most one per column. */
  | { kind: 'assign_mover' }
  /** Marks the card complete (it stays complete when it leaves the column). At most one per column. */
  | { kind: 'mark_completed' }
  /** Sets the due date to today + dueDays (0-365). At most one per column. */
  | { kind: 'set_due', dueDays: number }
  /** Adds the shared card button buttonId to the card (as if added to it by hand). */
  | { kind: 'add_button', buttonId: string }
  /** Removes the shared card button buttonId from the card (its columns may still offer it). */
  | { kind: 'remove_button', buttonId: string }

export type ColumnRule = NewColumnRule & { id: string }

/**
 * POST /api/columns/:id/rules body. A new tag, assignee or button rule also changes the
 * cards already in the column unless applyToExisting is false (default true).
 */
export type NewColumnRuleRequest = NewColumnRule & { applyToExisting?: boolean }

/**
 * Time-based automation of a board, run hourly. "Open" cards are the ones not
 * archived and not in the last column. With `columnId` an automation only looks
 * at the (unarchived) cards in that column, the last column included; it is
 * fixed at creation, and deleting the column deletes the automation. With
 * `cardId` (instead of a column) it only looks at that card, also when the card
 * has skipAutomations; move_card then counts the days in the card's current
 * column. Changes show up in the activity log with no actor and `automation: true`.
 */
export type NewBoardAutomation = (
  /** Archives cards that have been in the last column (or in columnId) for `days` days (1-365). */
  | { kind: 'archive_done', days: number }
  /** Adds tagId to open cards without activity for `days` days (1-365). */
  | { kind: 'tag_stale', days: number, tagId: string }
  /** Logs `stale` on open cards without activity for `days` days (1-365), notifying assignees and watchers. */
  | { kind: 'notify_stale', days: number }
  /** Raises open cards due within `days` days (0-365) or overdue to `priority`. */
  | { kind: 'raise_priority', days: number, priority: Priority }
  /**
   * Moves cards that have been in columnId (or cardId's current column) for `days` days (1-365)
   * to the end of targetColumnId; column rules run. Needs columnId or cardId; one per column or card.
   */
  | { kind: 'move_card', days: number, targetColumnId: string }
) & { columnId?: string | null, cardId?: string | null }

/**
 * One-shot action on a card, run on runOn (YYYY-MM-DD, by the hourly automations
 * task) and then deleted. Shows up in the activity log like an automation.
 */
export type NewScheduledCardAction = { runOn: string } & (
  /** Moves the card to the end of targetColumnId (column rules run). */
  | { kind: 'move', targetColumnId: string }
  | { kind: 'archive' }
  /** Sets the card's priority. */
  | { kind: 'priority', priority: Priority }
  /** Logs `reminder`, notifying assignees and watchers; note up to 500 characters. */
  | { kind: 'remind', note?: string | null }
)
export type ScheduledCardActionKind = NewScheduledCardAction['kind']
export const scheduledCardActionKinds = ['move', 'archive', 'priority', 'remind'] as const satisfies readonly ScheduledCardActionKind[]
export type ScheduledCardAction = NewScheduledCardAction & { id: string, cardId: string }

/** Events a board rule reacts to (board_rule_event). */
export const boardRuleEvents = ['card_created', 'card_moved', 'tag_added', 'assigned', 'due_set', 'checklist_completed', 'card_completed', 'commented'] as const
export type BoardRuleEvent = (typeof boardRuleEvents)[number]

/** All given (non-null) conditions must hold for the card when the rule runs. */
export interface BoardRuleConditions {
  /** The card carries this tag. */
  tagId: string | null
  priority: Priority | null
  /** The card is in this column. */
  columnId: string | null
  /** This person is among the card's assignees. */
  assigneeId: string | null
}

/** What a rule does; at least one action. Applied in this order. */
export interface BoardRuleActions {
  /** Moves the card to the end of this column (column rules run). */
  moveColumnId: string | null
  addTagId: string | null
  removeTagId: string | null
  /** Adds this board member to the assignees. */
  assignUserId: string | null
  priority: Priority | null
  /** Sets the due date to today + dueDays (0-365). */
  dueDays: number | null
  archive: boolean
}

/**
 * Event-triggered rule: "when <event> (optionally a given tag added / person
 * assigned) and <conditions>, do <actions>". Rules run when the change is saved,
 * with no actor (`automation: true` in the activity); their own changes do not
 * trigger rules. Deleting a tag, column or person a rule names deletes the rule.
 */
export interface NewBoardRule {
  event: BoardRuleEvent
  /** tag_added only: just this tag (null = any). */
  eventTagId: string | null
  /** assigned only: just this person (null = anyone). */
  eventUserId: string | null
  conditions: BoardRuleConditions
  actions: BoardRuleActions
}

export interface BoardRule extends NewBoardRule {
  id: string
  active: boolean
}

export const agentRuleEvents = ['card_created', 'card_moved', 'tag_added', 'assigned', 'mentioned'] as const
/** What starts an agent rule; assigned / mentioned mean the rule's bot was assigned or mentioned. */
export type AgentRuleEvent = (typeof agentRuleEvents)[number]
export const agentRuleComments = ['never', 'failure', 'always'] as const
export type AgentRuleComment = (typeof agentRuleComments)[number]
export const AGENT_RULE_NAME_MAX = 100
export const AGENT_RULE_INSTRUCTIONS_MAX = 20000

/**
 * Agent rule (0130_board_agent_rules_rls.sql): "when <event> (and the card is in
 * columnId / carries tagId; for tag_added: tagId is the added tag), the bot works
 * on the card with these instructions". Followed by `kanso agent run --board`
 * with the bot's token, which afterwards moves the card to moveColumnId (after a
 * successful run) and comments the exit status as `comment` says. Deleting the
 * bot or a column or tag the rule names deletes the rule.
 */
export interface NewAgentRule {
  name: string
  botId: string
  event: AgentRuleEvent
  columnId: string | null
  tagId: string | null
  /** Markdown prompt for the agent. */
  instructions: string
  moveColumnId: string | null
  comment: AgentRuleComment
  active?: boolean
}

export interface AgentRule extends NewAgentRule {
  id: string
  active: boolean
}

export type BoardAutomationKind = NewBoardAutomation['kind']
export const boardAutomationKinds = ['archive_done', 'tag_stale', 'notify_stale', 'raise_priority', 'move_card'] as const satisfies readonly BoardAutomationKind[]

export type BoardAutomation = NewBoardAutomation & {
  id: string
  /** null = all open cards of the board (or cardId). */
  columnId: string | null
  /** null = not limited to one card. */
  cardId: string | null
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

/** A card as shown on the board. Archived and snoozed cards are not part of the board. */
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
  /** Board and column automations leave the card alone (its own automations and scheduled actions still run). */
  skipAutomations?: boolean
  /** Emoji stickers on the card's front, in the order added (shared/stickers.ts). */
  stickers: string[]
  /** Who created the card; null once their account is gone (or for automations without a person). */
  createdBy: string | null
  /** The creator's name, null when they are gone or no longer visible to the caller. */
  createdByName: string | null
  /** ISO time the card was created. */
  createdAt: string
  /** ISO time it was marked complete (it stays in its column), null while open. Never on templates. */
  completedAt: string | null
}

/**
 * Fields a card PATCH may change in the dialog. archived moves the card to or
 * from the archive. (The PATCH also takes snoozedUntil and completed, sent by
 * useBoard.snoozeCard / wakeCard / setCardCompleted.)
 */
export type CardPatch = Partial<Pick<Card, 'title' | 'description' | 'assigneeIds' | 'tagIds' | 'startDate' | 'dueDate' | 'priority' | 'estimate' | 'coverAttachmentId' | 'skipAutomations' | 'stickers'> & { archived: boolean }>

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

/** A snoozed card (GET /api/boards/:id/snoozed): hidden from the board until snoozedUntil. */
export interface SnoozedCard {
  id: string
  columnId: string
  title: string
  /** YYYY-MM-DD; the hourly task wakes it on that day. */
  snoozedUntil: string
}

export interface ArchivedCard {
  id: string
  columnId: string
  title: string
  archivedAt: string
}

export interface ChecklistItem {
  id: string
  checklistId: string
  text: string
  done: boolean
  position: number
  /** A board member responsible for this item, or null. */
  assigneeId: string | null
  /** YYYY-MM-DD */
  dueDate: string | null
}

/** A named checklist of a card with its items in order. */
export interface Checklist {
  id: string
  name: string
  position: number
  items: ChecklistItem[]
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
  /** Grouped by emoji, in the order first used. */
  reactions: CommentReaction[]
}

export interface CommentReaction {
  emoji: string
  count: number
  /** The current user reacted with this emoji. */
  mine: boolean
  /** Who reacted (people the caller can still see). */
  names: string[]
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
  | 'linked' | 'unlinked' | 'field' | 'stale' | 'reminder' | 'snoozed' | 'woke' | 'completed' | 'reopened'
  | 'checklist_assigned'

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
   * reminder: { note? } (a scheduled remind action), or { user_id, note? } (a personal reminder, seen only by that user).
   * checklist_assigned: { user, user_id, item } (a checklist item's assignee was set; only that person is notified).
   * snoozed: { until } (YYYY-MM-DD); woke: {} (snooze cleared, by hand or by the hourly task).
   * completed / reopened: {} (marked complete, or open again).
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
  /** In order, each with its items in order. */
  checklists: Checklist[]
  /** The linked Matrix thread, if any. */
  matrixThread: CardMatrixThread | null
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
  /** The current user's own reminders on the card, soonest first. */
  reminders: CardReminder[]
}

/** A personal "remind me" on a card: at a fixed time, or relative to the due date. */
export interface CardReminder {
  id: string
  /** ISO time it fires; null for a due-date reminder while the card has no due date. */
  remindAt: string | null
  /** Due-date reminder: days before the due date (0 = on the day), at dueTime (HH:MM) in timeZone. */
  beforeDueDays: number | null
  dueTime: string | null
  timeZone: string | null
  note: string | null
  /** Set once a due-date reminder fired (a later due date re-arms it); fixed-time ones are deleted instead. */
  sentAt: string | null
}

export interface BoardDetail {
  id: string
  name: string
  background: BoardBackground | null
  /** Palette name replacing the primary colour on the board; null = app default. */
  accent: BoardAccent | null
  /** Colour, thickness and glow of the column frames; null = default ring. */
  columnOutline: ColumnOutline | null
  /** Where card buttons sit in their row; null = left. */
  buttonAlign: ButtonAlign | null
  role: BoardRole
  /** Set while the board is archived: read-only for everyone until an owner unarchives it. */
  archivedAt: string | null
  /** Whether the current user starred the board. */
  starred: boolean
  /** The current user's notifications from this board: all, direct (mentions and being assigned) or none. */
  notificationLevel: BoardNotificationLevel
  /** The connected Matrix room, if any. */
  matrix: BoardMatrixRoom | null
  team: { id: string, name: string } | null
  columns: Column[]
  /** Column groups in position order. */
  columnGroups: ColumnGroup[]
  assigneeGroups: AssigneeGroup[]
  /** Shared views and the user's own, by name. */
  savedViews: SavedView[]
  /** Card and board buttons: shared ones and the user's own. */
  buttons: BoardButton[]
  /** Unarchived cards; templates are not among them. */
  cards: Card[]
  /** Card templates (each in its default column), in title order. */
  templates: Card[]
  /** Recurring card schedules, at most one per template. */
  recurrences: CardRecurrence[]
  /** Time-based automations in creation order. */
  automations: BoardAutomation[]
  /** Event-triggered rules in creation order (none for members with limited access). */
  rules: BoardRule[]
  /** Agent rules by name (limited members: only the ones of their own bot user). */
  agentRules: AgentRule[]
  /** Scheduled card actions, soonest first. */
  scheduledActions: ScheduledCardAction[]
  tags: Tag[]
  /** Custom fields in position order. */
  fields: BoardField[]
  members: Member[]
  /** The board's bots by name; their tokens only for owners. */
  bots: BoardBot[]
  invites: Invite[]
  /** The current user's limits on this board; null = not limited (owners never are). */
  myAccess: MemberAccess | null
  /** Limits by user id: owners get every member's, others only their own. */
  memberAccess: Record<string, MemberAccess>
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
  /** The team's bots; their `tokens` only for team owners. */
  bots: BoardBot[]
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
