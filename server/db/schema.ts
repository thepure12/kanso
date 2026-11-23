import { sql } from 'drizzle-orm'
import { type AnyPgColumn, boolean, check, customType, date, doublePrecision, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

const citext = customType<{ data: string }>({ dataType: () => 'citext' })
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

import type { BoardBackground } from '../../shared/boardBackgrounds'
import { type BoardAccent, boardAccents } from '../../shared/boardAccents'
import type { ColumnOutline } from '../../shared/columnOutline'
import type { SavedViewConfig } from '../../shared/savedViews'
import type { ButtonAlign, ButtonColor, ButtonScope, ButtonStep } from '../../shared/buttons'
import type { NotificationPrefs } from '../../shared/notificationSettings'
import { reactionEmojis } from '../../shared/reactions'

// Shape of a column outline (shared/columnOutline.ts): exactly color, width, glow.
const outlineShape = (c: AnyPgColumn) => sql`${c} is null or (
    jsonb_typeof(${c}) = 'object'
    and ${c} ?& array['color', 'width', 'glow']
    and ${c} - 'color' - 'width' - 'glow' = '{}'::jsonb
    and (${c}->'color' = 'null'::jsonb or ${c}->>'color' in ('accent', 'column') or ${c}->>'color' ~ '^#[0-9a-f]{6}$')
    and ${c}->'width' in ('1', '2', '3', '4')
    and ${c}->'glow' in ('0', '1', '2', '3'))`

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const boardRole = pgEnum('board_role', ['owner', 'editor', 'commenter', 'viewer'])

export const columnRuleKind = pgEnum('column_rule_kind', ['apply_tag', 'assign_to', 'remove_tag', 'set_due', 'assign_mover', 'add_button', 'remove_button'])

export const signupMode = pgEnum('signup_mode', ['open', 'restricted'])

export const cardPriority = pgEnum('card_priority', ['low', 'medium', 'high', 'urgent'])

export const cardLinkKind = pgEnum('card_link_kind', ['blocks', 'relates', 'duplicates'])

export const boardFieldKind = pgEnum('board_field_kind', ['text', 'number', 'date', 'select', 'checkbox', 'url'])

export const recurrenceRule = pgEnum('recurrence_rule', ['daily', 'weekly', 'monthly'])

// 'all' is the absence of a board_notification_settings row.
export const boardNotificationLevel = pgEnum('board_notification_level', ['direct', 'none'])

export const boardAutomationKind = pgEnum('board_automation_kind', ['archive_done', 'tag_stale', 'notify_stale', 'raise_priority', 'move_card'])
export const boardRuleEvent = pgEnum('board_rule_event', ['card_created', 'card_moved', 'tag_added', 'assigned', 'due_set', 'checklist_completed', 'commented'])
// What starts an agent rule (board_agent_rules), followed by `kanso agent run`.
export const agentRuleEvent = pgEnum('agent_rule_event', ['card_created', 'card_moved', 'tag_added', 'assigned', 'mentioned'])
// One-shot action on a card on a date (card_scheduled_actions).
export const cardActionKind = pgEnum('card_action_kind', ['move', 'archive', 'priority', 'remind'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  passwordHash: text('password_hash'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // Bumped on password or email change; sessions carrying an older value are rejected.
  sessionVersion: integer('session_version').notNull().default(0),
  // Opt-in daily email digest of unread notifications (server/tasks/notifications/digest.ts).
  digestEnabled: boolean('digest_enabled').notNull().default(false),
  digestSentAt: timestamp('digest_sent_at', { withTimezone: true }),
  // UI language ('en', 'de'; null = browser). Also picks the language of mails and webhook messages.
  locale: text('locale'),
  // Channels per notification event, missing = on (shared/notificationSettings.ts);
  // shape checked by app.notification_prefs_valid (0070_notification_settings_rls.sql).
  notificationPrefs: jsonb('notification_prefs').$type<NotificationPrefs>().notNull().default({}),
  // False: cards the user only watches send nothing (assignments and mentions still do).
  notifyWatching: boolean('notify_watching').notNull().default(true),
  // Board bots (0102_board_bots_rls.sql): a user that exists only for one
  // board, made by its owners through app.create_board_bot. Never signs in
  // (placeholder bot-<id>@bots.invalid email, no password, never verified),
  // only acts through API tokens limited to that board. Deleted with it.
  // Team bots (0106_team_bots_rls.sql) are the same for one team
  // (bot_team_id): team members, tokens limited to the team's boards.
  // Account bots (0109_account_bots_rls.sql) belong to a person (bot_owner_id),
  // who adds them to boards they own; deleted with that account.
  isBot: boolean('is_bot').notNull().default(false),
  botBoardId: uuid('bot_board_id').references((): AnyPgColumn => boards.id, { onDelete: 'cascade' }),
  botTeamId: uuid('bot_team_id').references((): AnyPgColumn => teams.id, { onDelete: 'cascade' }),
  botOwnerId: uuid('bot_owner_id').references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, t => [
  check('users_bot_scope', sql`${t.isBot} = (num_nonnulls(${t.botBoardId}, ${t.botTeamId}, ${t.botOwnerId}) = 1)`),
  check('users_bot_email', sql`not ${t.isBot} or ${t.email} like 'bot-%@bots.invalid'`),
  index('users_bot_board_idx').on(t.botBoardId).where(sql`${t.botBoardId} is not null`),
  index('users_bot_team_idx').on(t.botTeamId).where(sql`${t.botTeamId} is not null`),
  index('users_bot_owner_idx').on(t.botOwnerId).where(sql`${t.botOwnerId} is not null`),
])

export const oauthAccounts = pgTable('oauth_accounts', {
  provider: text('provider').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.provider, t.providerUserId] })])

// Instance administrators: edit instance_settings, promote other users and
// remove accounts. NUXT_ADMIN_EMAIL is added on sign-in (app.bootstrap_admin).
export const instanceAdmins = pgTable('instance_admins', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
})

// Single row of instance-wide sign-up settings, edited by admins.
// Domains and emails are stored lower case; domains without a leading '@'.
export const instanceSettings = pgTable('instance_settings', {
  id: boolean('id').primaryKey().default(true),
  signupMode: signupMode('signup_mode').notNull().default('restricted'),
  allowedDomains: text('allowed_domains').array().notNull().default(sql`'{}'`),
  allowedEmails: text('allowed_emails').array().notNull().default(sql`'{}'`),
  // Restricted mode: whether a board/team invite admits an email outside the allowlist.
  allowExternalInvites: boolean('allow_external_invites').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('instance_settings_single_row', sql`${t.id}`)])

// Fixed-window counters for login / sign-up / reset attempts. Touched only by
// app.hit_rate_limit (kanban_auth), which also purges expired rows.
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
}, t => [index('rate_limits_reset_at_idx').on(t.resetAt)])

// TOTP two-factor secret (AES-256-GCM, server/utils/secretBox.ts). enabled_at
// is null between setup and the first confirmed code. last_used_step blocks
// replaying a code. kanban_auth only, like password_hash.
export const userTotp = pgTable('user_totp', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  secretEnc: text('secret_enc').notNull(),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  lastUsedStep: integer('last_used_step'),
  createdAt: createdAt(),
})

// One-time recovery codes for two-factor sign-in, stored as sha256 hex. kanban_auth only.
export const userRecoveryCodes = pgTable('user_recovery_codes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.userId, t.codeHash] })])

// Signed-in devices. The session cookie carries the row id; withUser
// (app.check_session) rejects revoked rows. Bumping users.session_version
// revokes every row of that user.
export const userSessions = pgTable('user_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, t => [index('user_sessions_user_idx').on(t.userId)])

// Instance admin actions, written only by SECURITY DEFINER code
// (app.log_admin_action). Names and emails go into data, so entries stay
// readable after the accounts are deleted. Admins read it.
export const adminAuditLog = pgTable('admin_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
  data: jsonb('data').notNull().default(sql`'{}'`),
  createdAt: createdAt(),
}, t => [index('admin_audit_log_created_idx').on(t.createdAt)])

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
})

// Team roles reuse board_role: a team member gets that role on every board in the team.
export const teamMembers = pgTable('team_members', {
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: boardRole('role').notNull(),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.teamId, t.userId] })])

export const boards = pgTable('boards', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Null for personal boards. Set at creation only.
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // Creator. Kept when the creator's account is removed (null then).
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  // Archived boards are read-only for everyone (app.can_edit is false). Set by
  // owners through app.set_board_archived only (see 0035_board_stars_archive_rls.sql).
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  // Colour, gradient, stock photo or uploaded image (board_backgrounds); null = plain.
  // Owners change it (column grant); see 0045_board_backgrounds_rls.sql.
  background: jsonb('background').$type<BoardBackground>(),
  // Palette name that replaces the primary colour on the board; null = app default.
  // Owners change it (column grant); see shared/boardAccents.ts.
  accent: text('accent').$type<BoardAccent>(),
  // Colour, thickness and glow of the column frames (columns.outline overrides
  // it per column); null = default ring.
  // Owners change it (column grant); see shared/columnOutline.ts.
  columnOutline: jsonb('column_outline').$type<ColumnOutline>(),
  // Where card buttons sit in their row on cards: left, center or right; null = left.
  // Owners change it (column grant); see shared/buttons.ts.
  buttonAlign: text('button_align').$type<ButtonAlign>(),
  createdAt: createdAt(),
}, t => [
  check('boards_background_shape', sql`${t.background} is null
    or (${t.background}->>'kind' = 'color' and ${t.background}->>'value' ~ '^#[0-9a-f]{6}$')
    or (${t.background}->>'kind' in ('gradient', 'photo', 'upload') and ${t.background}->>'value' ~ '^[a-z0-9-]{1,40}$')`),
  check('boards_accent_known', sql`${t.accent} is null or ${t.accent} in (${sql.raw(boardAccents.map(a => `'${a}'`).join(', '))})`),
  check('boards_column_outline_shape', outlineShape(t.columnOutline)),
  check('boards_button_align_known', sql`${t.buttonAlign} is null or ${t.buttonAlign} in ('left', 'center', 'right')`),
])

// The uploaded image of a board whose background kind is 'upload'. One per board.
export const boardBackgrounds = pgTable('board_backgrounds', {
  boardId: uuid('board_id').primaryKey().references(() => boards.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
}, t => [
  check('board_backgrounds_type', sql`${t.contentType} in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')`),
  check('board_backgrounds_size', sql`${t.size} between 1 and 5242880 and octet_length(${t.data}) = ${t.size}`),
])

// A profile picture the user uploaded; users.avatar_url then points at
// GET /api/users/:id/avatar. One per user, small (the client resizes it first).
// See 0060_user_avatars_rls.sql.
export const userAvatars = pgTable('user_avatars', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
}, t => [
  check('user_avatars_type', sql`${t.contentType} in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')`),
  check('user_avatars_size', sql`${t.size} between 1 and 1048576 and octet_length(${t.data}) = ${t.size}`),
])

// Boards a user starred; listed first on the home page and in the command palette.
// Personal: each user sees and changes only their own rows.
export const boardStars = pgTable('board_stars', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.userId, t.boardId] })])

// Per-user notification level for a board; no row = all. Personal like stars.
export const boardNotificationSettings = pgTable('board_notification_settings', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  level: boardNotificationLevel('level').notNull(),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.userId, t.boardId] }), index('board_notification_settings_board_idx').on(t.boardId)])

export const boardMembers = pgTable('board_members', {
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: boardRole('role').notNull(),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.boardId, t.userId] })])

// Pending membership for an email with no account yet. Claimed by a trigger when
// that email signs up; also lets the email past a restricted sign-up gate.
export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull(),
  boardId: uuid('board_id').references(() => boards.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  role: boardRole('role').notNull(),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  check('invites_one_target', sql`num_nonnulls(${t.boardId}, ${t.teamId}) = 1`),
  uniqueIndex('invites_email_board').on(t.email, t.boardId).where(sql`${t.boardId} is not null`),
  uniqueIndex('invites_email_team').on(t.email, t.teamId).where(sql`${t.teamId} is not null`),
  index('invites_email').on(t.email),
])

export const columns = pgTable('columns', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  position: doublePrecision('position').notNull(),
  // Heading colour as lowercase #rrggbb. Null = default.
  color: text('color'),
  // Soft work-in-progress limit: the UI warns when the column holds more cards. Null = none.
  wipLimit: integer('wip_limit'),
  // Frame colour, thickness and glow; null = the board's column_outline.
  outline: jsonb('outline').$type<ColumnOutline>(),
  createdAt: createdAt(),
}, t => [
  unique('columns_id_board_id_unique').on(t.id, t.boardId),
  check('columns_color_hex', sql`${t.color} ~ '^#[0-9a-f]{6}$'`),
  check('columns_wip_limit_range', sql`${t.wipLimit} between 1 and 999`),
  check('columns_outline_shape', outlineShape(t.outline)),
])

// Named set of a board's columns, so the board view can show one group only.
// A column can be in several groups. See 0051_column_groups_rls.sql.
export const columnGroups = pgTable('column_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // Chip colour as lowercase #rrggbb. Null = default.
  color: text('color'),
  position: doublePrecision('position').notNull(),
  createdAt: createdAt(),
}, t => [
  unique('column_groups_id_board_id_unique').on(t.id, t.boardId),
  uniqueIndex('column_groups_board_name_unique').on(t.boardId, sql`lower(${t.name})`),
  check('column_groups_name_length', sql`char_length(${t.name}) between 1 and 50`),
  check('column_groups_color_hex', sql`${t.color} ~ '^#[0-9a-f]{6}$'`),
])

// Composite FKs: a group only holds columns of its own board.
export const columnGroupMembers = pgTable('column_group_members', {
  groupId: uuid('group_id').notNull(),
  columnId: uuid('column_id').notNull(),
  boardId: uuid('board_id').notNull(),
}, t => [
  primaryKey({ columns: [t.groupId, t.columnId] }),
  index('column_group_members_column_idx').on(t.columnId),
  foreignKey({ columns: [t.groupId, t.boardId], foreignColumns: [columnGroups.id, columnGroups.boardId], name: 'column_group_members_group_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.columnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'column_group_members_column_fk' }).onDelete('cascade'),
])

// Assignee groups: named sets of a board's people ("Frontend" = Ann + Bob).
// Assigning a group adds its members as normal assignees; the group is never
// an assignee itself. See 0111_assignee_groups_rls.sql.
export const assigneeGroups = pgTable('assignee_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: createdAt(),
}, t => [
  unique('assignee_groups_id_board_id_unique').on(t.id, t.boardId),
  uniqueIndex('assignee_groups_board_name_unique').on(t.boardId, sql`lower(${t.name})`),
  check('assignee_groups_name_length', sql`char_length(${t.name}) between 1 and 50`),
])

// Composite FK: a member row belongs to its group's board. Members must be on
// the board when added (policy); rows of people who later leave stay but are
// left out when loaded.
export const assigneeGroupMembers = pgTable('assignee_group_members', {
  groupId: uuid('group_id').notNull(),
  boardId: uuid('board_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, t => [
  primaryKey({ columns: [t.groupId, t.userId] }),
  index('assignee_group_members_user_idx').on(t.userId),
  foreignKey({ columns: [t.groupId, t.boardId], foreignColumns: [assigneeGroups.id, assigneeGroups.boardId], name: 'assignee_group_members_group_fk' }).onDelete('cascade'),
])

// Named board view (view, grouping, column group, filter). user_id null = shared
// on the board (editors manage), else personal. See 0066_saved_views_rls.sql.
export const savedViews = pgTable('saved_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  config: jsonb('config').$type<SavedViewConfig>().notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  uniqueIndex('saved_views_name_unique').on(t.boardId, sql`coalesce(${t.userId}, '00000000-0000-0000-0000-000000000000'::uuid)`, sql`lower(${t.name})`),
  index('saved_views_user_idx').on(t.userId),
  check('saved_views_name_length', sql`char_length(${t.name}) between 1 and 50`),
  check('saved_views_config_shape', sql`jsonb_typeof(${t.config}) = 'object' and pg_column_size(${t.config}) < 16384`),
])

// Named list of steps run with one click on a card (scope card) or the board
// (scope board). user_id null = shared on the board (editors manage), else
// personal. See 0117_board_buttons_rls.sql and shared/buttons.ts.
export const boardButtons = pgTable('board_buttons', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scope: text('scope').$type<ButtonScope>().notNull(),
  name: text('name').notNull(),
  icon: text('icon'),
  color: text('color').$type<ButtonColor>().notNull().default('accent'),
  // Optional text shown when hovering the button; null = none.
  tooltip: text('tooltip'),
  steps: jsonb('steps').$type<ButtonStep[]>().notNull(),
  // Card buttons only: the columns whose cards offer the button; null = every
  // column, empty = none (then only the cards in board_button_cards).
  columnIds: uuid('column_ids').array(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  unique('board_buttons_id_board_id_unique').on(t.id, t.boardId),
  uniqueIndex('board_buttons_name_unique').on(t.boardId, sql`coalesce(${t.userId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.scope, sql`lower(${t.name})`),
  index('board_buttons_user_idx').on(t.userId),
  check('board_buttons_scope', sql`${t.scope} in ('card', 'board')`),
  check('board_buttons_color_shape', sql`${t.color} = 'accent' or ${t.color} ~ '^#[0-9a-f]{6}$'`),
  check('board_buttons_name_length', sql`char_length(${t.name}) between 1 and 50`),
  check('board_buttons_tooltip_length', sql`${t.tooltip} is null or char_length(${t.tooltip}) between 1 and 200`),
  check('board_buttons_columns', sql`${t.columnIds} is null or (${t.scope} = 'card' and cardinality(${t.columnIds}) <= 100)`),
  check('board_buttons_steps_shape', sql`jsonb_typeof(${t.steps}) = 'array' and jsonb_array_length(${t.steps}) between 1 and 10 and pg_column_size(${t.steps}) < 16384`),
])

export const cards = pgTable('cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  columnId: uuid('column_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  position: doublePrecision('position').notNull(),
  // Optional start of the card's schedule; on or before due_date when both are set.
  startDate: date('start_date'),
  dueDate: date('due_date'),
  priority: cardPriority('priority'),
  // Story points.
  estimate: numeric('estimate', { precision: 6, scale: 2, mode: 'number' }),
  // Image attachment of this card shown on the board. Same card and image type
  // are checked by trigger (see 0029_card_schedule_time_rls.sql).
  coverAttachmentId: uuid('cover_attachment_id').references((): AnyPgColumn => cardAttachments.id, { onDelete: 'set null' }),
  // Archived cards are hidden from the board but keep their column and position.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  // Card template: kept in its column (the default target) but left out of the
  // board, search, notifications and column rules. Fixed at creation (trigger).
  // See 0037_card_templates_recurring_rls.sql.
  isTemplate: boolean('is_template').notNull().default(false),
  // Trash: a deleted card is hidden by the cards_select policy (so every query
  // skips it) and purged after 30 days. Set and cleared only through
  // app.trash_card / app.restore_card. See 0058_card_trash_rls.sql.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  // Board and column automations leave the card alone; its own automations and
  // scheduled actions still run. See 0086_card_automations_rls.sql.
  skipAutomations: boolean('skip_automations').notNull().default(false),
  // Snoozed: hidden from the board (like archived) until the hourly task wakes
  // it on this date; automations skip it. Never on templates. See 0094_card_snooze_rls.sql.
  snoozedUntil: date('snoozed_until'),
  // Null once the creator's account is removed.
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Full-text search (GET /api/search). 'simple' config: no stemming, language-neutral.
  search: tsvector('search').notNull().generatedAlwaysAs(sql`setweight(to_tsvector('simple'::regconfig, title), 'A') || setweight(to_tsvector('simple'::regconfig, description), 'B')`),
}, t => [
  unique('cards_id_board_id_unique').on(t.id, t.boardId),
  index('cards_search_idx').using('gin', t.search),
  index('cards_trash_idx').on(t.boardId, t.deletedAt).where(sql`${t.deletedAt} is not null`),
  // Composite FK: a card can only live in a column of its own board.
  foreignKey({ columns: [t.columnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'cards_column_board_fk' }).onDelete('cascade'),
  check('cards_start_before_due', sql`${t.startDate} <= ${t.dueDate}`),
  check('cards_estimate_range', sql`${t.estimate} >= 0`),
  check('cards_snooze_not_template', sql`not (${t.isTemplate} and ${t.snoozedUntil} is not null)`),
  // CARD_TITLE_MAX (shared/cards.ts).
  check('cards_title_length', sql`char_length(${t.title}) <= 1000`),
])

// Card buttons added to single cards: offered there whatever the button's
// columns. Personal buttons by their user, shared ones by editors of the card.
// See 0124_board_button_cards_rls.sql.
export const boardButtonCards = pgTable('board_button_cards', {
  buttonId: uuid('button_id').notNull(),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
}, t => [
  primaryKey({ columns: [t.buttonId, t.cardId] }),
  index('board_button_cards_card_idx').on(t.cardId),
  foreignKey({ columns: [t.buttonId, t.boardId], foreignColumns: [boardButtons.id, boardButtons.boardId], name: 'board_button_cards_button_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.cardId, t.boardId], foreignColumns: [cards.id, cards.boardId], name: 'board_button_cards_card_fk' }).onDelete('cascade'),
])

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // Lowercase #rrggbb.
  color: text('color').notNull(),
  createdAt: createdAt(),
}, t => [
  unique('tags_id_board_id_unique').on(t.id, t.boardId),
  unique('tags_board_id_name_unique').on(t.boardId, t.name),
  check('tags_color_hex', sql`${t.color} ~ '^#[0-9a-f]{6}$'`),
])

// board_id is denormalised so both composite FKs pin card and tag to the same board.
export const cardTags = pgTable('card_tags', {
  cardId: uuid('card_id').notNull(),
  tagId: uuid('tag_id').notNull(),
  boardId: uuid('board_id').notNull(),
}, t => [
  primaryKey({ columns: [t.cardId, t.tagId] }),
  foreignKey({ columns: [t.cardId, t.boardId], foreignColumns: [cards.id, cards.boardId], name: 'card_tags_card_board_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.tagId, t.boardId], foreignColumns: [tags.id, tags.boardId], name: 'card_tags_tag_board_fk' }).onDelete('cascade'),
])

// Automations attached to a column. Applied by triggers on cards when a card
// enters the column (created in it or moved into it).
// apply_tag: adds tag_id to the card.
// remove_tag: removes tag_id from the card.
// assign_to: adds user_id to the card's assignees.
// assign_mover: adds the person who created or moved the card (app.user_id) to its assignees.
// set_due: sets the card's due date to today + due_days.
// add_button / remove_button: adds the shared card button button_id to the card
// (board_button_cards) or removes it from the card. See 0126_column_rule_buttons_rls.sql.
// The check compares kind::text so a migration that adds a kind can use it in the same transaction.
export const columnRules = pgTable('column_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull(),
  columnId: uuid('column_id').notNull(),
  kind: columnRuleKind('kind').notNull(),
  tagId: uuid('tag_id'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  dueDays: integer('due_days'),
  buttonId: uuid('button_id'),
  createdAt: createdAt(),
}, t => [
  unique('column_rules_column_kind_tag_unique').on(t.columnId, t.kind, t.tagId),
  unique('column_rules_column_kind_user_unique').on(t.columnId, t.kind, t.userId),
  unique('column_rules_column_kind_button_unique').on(t.columnId, t.kind, t.buttonId),
  foreignKey({ columns: [t.columnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'column_rules_column_board_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.tagId, t.boardId], foreignColumns: [tags.id, tags.boardId], name: 'column_rules_tag_board_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.buttonId, t.boardId], foreignColumns: [boardButtons.id, boardButtons.boardId], name: 'column_rules_button_board_fk' }).onDelete('cascade'),
  // At most one set_due rule per column (due_days is set only on set_due rules, check below).
  uniqueIndex('column_rules_one_due_per_column').on(t.columnId).where(sql`${t.dueDays} is not null`),
  // At most one assign_mover rule per column (the only kind with no tag, user, days or button).
  uniqueIndex('column_rules_one_mover_per_column').on(t.columnId).where(sql`${t.tagId} is null and ${t.userId} is null and ${t.dueDays} is null and ${t.buttonId} is null`),
  check('column_rules_kind_fields', sql`case ${t.kind}::text
    when 'apply_tag' then ${t.tagId} is not null and ${t.userId} is null and ${t.dueDays} is null and ${t.buttonId} is null
    when 'remove_tag' then ${t.tagId} is not null and ${t.userId} is null and ${t.dueDays} is null and ${t.buttonId} is null
    when 'assign_to' then ${t.userId} is not null and ${t.tagId} is null and ${t.dueDays} is null and ${t.buttonId} is null
    when 'set_due' then ${t.dueDays} between 0 and 365 and ${t.tagId} is null and ${t.userId} is null and ${t.buttonId} is null
    when 'assign_mover' then ${t.tagId} is null and ${t.userId} is null and ${t.dueDays} is null and ${t.buttonId} is null
    when 'add_button' then ${t.buttonId} is not null and ${t.tagId} is null and ${t.userId} is null and ${t.dueDays} is null
    when 'remove_button' then ${t.buttonId} is not null and ${t.tagId} is null and ${t.userId} is null and ${t.dueDays} is null
    else false
  end`),
])

// Time-based automations of a board, run hourly by app.run_board_automations()
// (server/tasks/cards/automations.ts). See 0056_board_automations_rls.sql.
// archive_done: archives cards that have been in the last column for `days` days.
// tag_stale: adds tag_id to open cards (not in the last column) without activity for `days` days.
// notify_stale: logs `stale` on such cards, so assignees and watchers are notified.
// raise_priority: raises open cards due within `days` days (or overdue) to `priority`.
// move_card: moves cards that have been in column_id for `days` days to the end of target_column_id.
// column_id (optional except for move_card, fixed at creation) limits an automation to the cards
// in that column (the last column too); archive_done then counts the days in that column.
// card_id (fixed at creation, not with column_id) limits it to one card; move_card then counts
// the days in the card's current column. Cards with skip_automations only get their own.
export const boardAutomations = pgTable('board_automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  kind: boardAutomationKind('kind').notNull(),
  days: integer('days').notNull(),
  tagId: uuid('tag_id'),
  priority: cardPriority('priority'),
  columnId: uuid('column_id'),
  targetColumnId: uuid('target_column_id'),
  cardId: uuid('card_id'),
  active: boolean('active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: createdAt(),
}, t => [
  unique('board_automations_unique').on(t.boardId, t.kind, t.columnId, t.cardId, t.tagId, t.priority).nullsNotDistinct(),
  foreignKey({ columns: [t.tagId, t.boardId], foreignColumns: [tags.id, tags.boardId], name: 'board_automations_tag_board_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.columnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'board_automations_column_board_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.targetColumnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'board_automations_target_board_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.cardId, t.boardId], foreignColumns: [cards.id, cards.boardId], name: 'board_automations_card_board_fk' }).onDelete('cascade'),
  check('board_automations_scope', sql`${t.columnId} is null or ${t.cardId} is null`),
  check('board_automations_kind_fields', sql`case ${t.kind}::text
    when 'archive_done' then ${t.days} between 1 and 365 and ${t.tagId} is null and ${t.priority} is null and ${t.targetColumnId} is null
    when 'tag_stale' then ${t.days} between 1 and 365 and ${t.tagId} is not null and ${t.priority} is null and ${t.targetColumnId} is null
    when 'notify_stale' then ${t.days} between 1 and 365 and ${t.tagId} is null and ${t.priority} is null and ${t.targetColumnId} is null
    when 'raise_priority' then ${t.days} between 0 and 365 and ${t.priority} is not null and ${t.tagId} is null and ${t.targetColumnId} is null
    when 'move_card' then ${t.days} between 1 and 365 and ${t.tagId} is null and ${t.priority} is null
      and (${t.columnId} is not null or ${t.cardId} is not null) and ${t.targetColumnId} is not null and ${t.targetColumnId} is distinct from ${t.columnId}
    else false
  end`),
])

// Event-triggered rules of a board: "when <event> and <conditions>, do <actions>".
// See 0096_board_rules_rls.sql. Triggers on cards, card_tags, card_assignees,
// checklist_items and card_comments queue the event; the rules run when the
// transaction commits, in automation mode (no actor), and changes they make do
// not trigger rules again.
// event_tag_id (tag_added only) and event_user_id (assigned only) narrow the event.
// cond_*: all given conditions must hold for the card at commit time.
// Actions (at least one): move to the end of move_column_id, add/remove a tag,
// assign a user (board members only), set the priority, set the due date to today
// + set_due_days, archive. Every referenced tag, column and user belongs to the
// board (composite FKs); deleting one deletes the rule.
export const boardRules = pgTable('board_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  event: boardRuleEvent('event').notNull(),
  eventTagId: uuid('event_tag_id'),
  eventUserId: uuid('event_user_id').references(() => users.id, { onDelete: 'cascade' }),
  condTagId: uuid('cond_tag_id'),
  condPriority: cardPriority('cond_priority'),
  condColumnId: uuid('cond_column_id'),
  condAssigneeId: uuid('cond_assignee_id').references(() => users.id, { onDelete: 'cascade' }),
  moveColumnId: uuid('move_column_id'),
  addTagId: uuid('add_tag_id'),
  removeTagId: uuid('remove_tag_id'),
  assignUserId: uuid('assign_user_id').references(() => users.id, { onDelete: 'cascade' }),
  setPriority: cardPriority('set_priority'),
  setDueDays: integer('set_due_days'),
  archive: boolean('archive').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  index('board_rules_board_idx').on(t.boardId),
  foreignKey({ columns: [t.eventTagId, t.boardId], foreignColumns: [tags.id, tags.boardId], name: 'board_rules_event_tag_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.condTagId, t.boardId], foreignColumns: [tags.id, tags.boardId], name: 'board_rules_cond_tag_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.condColumnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'board_rules_cond_column_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.moveColumnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'board_rules_move_column_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.addTagId, t.boardId], foreignColumns: [tags.id, tags.boardId], name: 'board_rules_add_tag_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.removeTagId, t.boardId], foreignColumns: [tags.id, tags.boardId], name: 'board_rules_remove_tag_fk' }).onDelete('cascade'),
  check('board_rules_event_fields', sql`(${t.eventTagId} is null or ${t.event}::text = 'tag_added') and (${t.eventUserId} is null or ${t.event}::text = 'assigned')`),
  check('board_rules_has_action', sql`${t.moveColumnId} is not null or ${t.addTagId} is not null or ${t.removeTagId} is not null
    or ${t.assignUserId} is not null or ${t.setPriority} is not null or ${t.setDueDays} is not null or ${t.archive}`),
  check('board_rules_due_days', sql`${t.setDueDays} between 0 and 365`),
  check('board_rules_tags_differ', sql`${t.addTagId} is distinct from ${t.removeTagId} or ${t.addTagId} is null`),
])

// Queue of rule events (no grants): written by the event triggers, read and
// deleted at commit by the deferred trigger that runs the rules.
export const boardRuleEvents = pgTable('board_rule_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  event: boardRuleEvent('event').notNull(),
  tagId: uuid('tag_id'),
  userId: uuid('user_id'),
})

// Agent rules of a board (0130_board_agent_rules_rls.sql): "when <event> (and the
// card is in column_id / carries tag_id), the bot bot_id works on the card with
// these instructions". The database only stores them; `kanso agent run --board`
// with the bot's token follows them (cli/src/agent.ts): it runs the command or
// Claude per matching event and afterwards optionally moves the card to
// move_column_id (on success) and comments the exit status (`comment`).
// assigned / mentioned mean the rule's bot was assigned / mentioned. Deleting the
// bot, a named column or tag deletes the rule.
export const boardAgentRules = pgTable('board_agent_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  botId: uuid('bot_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  event: agentRuleEvent('event').notNull(),
  columnId: uuid('column_id'),
  tagId: uuid('tag_id'),
  instructions: text('instructions').notNull(),
  moveColumnId: uuid('move_column_id'),
  comment: text('comment').notNull().default('never'),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  index('board_agent_rules_board_idx').on(t.boardId),
  foreignKey({ columns: [t.columnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'board_agent_rules_column_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.tagId, t.boardId], foreignColumns: [tags.id, tags.boardId], name: 'board_agent_rules_tag_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.moveColumnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'board_agent_rules_move_column_fk' }).onDelete('cascade'),
  check('board_agent_rules_name_length', sql`char_length(btrim(${t.name})) between 1 and 100`),
  check('board_agent_rules_instructions_length', sql`char_length(btrim(${t.instructions})) between 1 and 20000`),
  check('board_agent_rules_comment_known', sql`${t.comment} in ('never', 'failure', 'always')`),
])

// One-shot actions on a card, run on run_on by app.run_scheduled_card_actions()
// (cards:automations task) and then deleted. move: to the end of target_column_id;
// archive; priority: sets priority; remind: logs `reminder` {note}, notifying
// assignees and watchers. See 0086_card_automations_rls.sql.
export const cardScheduledActions = pgTable('card_scheduled_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  cardId: uuid('card_id').notNull(),
  kind: cardActionKind('kind').notNull(),
  runOn: date('run_on').notNull(),
  targetColumnId: uuid('target_column_id'),
  priority: cardPriority('priority'),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  index('card_scheduled_actions_run_on_idx').on(t.runOn),
  foreignKey({ columns: [t.cardId, t.boardId], foreignColumns: [cards.id, cards.boardId], name: 'card_scheduled_actions_card_board_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.targetColumnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'card_scheduled_actions_target_board_fk' }).onDelete('cascade'),
  check('card_scheduled_actions_kind_fields', sql`case ${t.kind}
    when 'move' then ${t.targetColumnId} is not null and ${t.priority} is null and ${t.note} is null
    when 'priority' then ${t.priority} is not null and ${t.targetColumnId} is null and ${t.note} is null
    when 'archive' then ${t.targetColumnId} is null and ${t.priority} is null and ${t.note} is null
    when 'remind' then ${t.targetColumnId} is null and ${t.priority} is null and coalesce(char_length(${t.note}), 0) <= 500
    else false
  end`),
])

// Personal "remind me" on a card (like card_watchers: own rows only). Either at
// a fixed time (remind_at given) or `before_due_days` days before the card's due
// date at `due_time` in `time_zone` (remind_at computed by a trigger, recomputed
// when the due date changes, null without one). app.run_card_reminders()
// (cards:reminders task, every minute) logs a `reminder` activity {user_id, note}
// seen and notified only to that user, then sets sent_at. See 0090_card_reminders_rls.sql.
export const cardReminders = pgTable('card_reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  remindAt: timestamp('remind_at', { withTimezone: true }),
  beforeDueDays: smallint('before_due_days'),
  dueTime: text('due_time'),
  timeZone: text('time_zone'),
  note: text('note'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: createdAt(),
}, t => [
  foreignKey({ columns: [t.cardId, t.boardId], foreignColumns: [cards.id, cards.boardId], name: 'card_reminders_card_board_fk' }).onDelete('cascade'),
  index('card_reminders_card_user_idx').on(t.cardId, t.userId),
  index('card_reminders_due_idx').on(t.remindAt).where(sql`${t.sentAt} is null`),
  check('card_reminders_shape', sql`(${t.beforeDueDays} is null and ${t.dueTime} is null and ${t.timeZone} is null and ${t.remindAt} is not null)
    or (${t.beforeDueDays} between 0 and 365 and ${t.dueTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${t.timeZone} is not null)`),
  check('card_reminders_note_length', sql`coalesce(char_length(${t.note}), 0) <= 500`),
])

// The same composite-FK pattern as card_tags: board_id pins every row to its card's board.
const cardFk = (name: string, t: { cardId: AnyPgColumn, boardId: AnyPgColumn }) =>
  foreignKey({ columns: [t.cardId, t.boardId], foreignColumns: [cards.id, cards.boardId], name }).onDelete('cascade')

export const cardAssignees = pgTable('card_assignees', {
  cardId: uuid('card_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  boardId: uuid('board_id').notNull(),
}, t => [
  primaryKey({ columns: [t.cardId, t.userId] }),
  cardFk('card_assignees_card_board_fk', t),
])

// Named checklists of a card; items belong to one of them (same card, composite FK).
export const checklists = pgTable('checklists', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  name: text('name').notNull(),
  position: doublePrecision('position').notNull(),
  createdAt: createdAt(),
}, t => [
  cardFk('checklists_card_board_fk', t),
  unique('checklists_id_card_id_unique').on(t.id, t.cardId),
  index('checklists_card_idx').on(t.cardId),
  check('checklists_name_length', sql`char_length(${t.name}) between 1 and 100`),
])

export const checklistItems = pgTable('checklist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  checklistId: uuid('checklist_id').notNull(),
  text: text('text').notNull(),
  done: boolean('done').notNull().default(false),
  position: doublePrecision('position').notNull(),
  // Optional person (a board member, checked by trigger) and due date of one item.
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  dueDate: date('due_date'),
  createdAt: createdAt(),
}, t => [
  cardFk('checklist_items_card_board_fk', t),
  foreignKey({ columns: [t.checklistId, t.cardId], foreignColumns: [checklists.id, checklists.cardId], name: 'checklist_items_checklist_card_fk' }).onDelete('cascade'),
  index('checklist_items_card_idx').on(t.cardId),
  index('checklist_items_checklist_idx').on(t.checklistId),
  index('checklist_items_assignee_idx').on(t.assigneeId).where(sql`${t.assigneeId} is not null`),
])

export const cardComments = pgTable('card_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  // Null once the author's account is deleted.
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  // Display name of the original author of an imported comment (author_id is null then).
  importedAuthor: text('imported_author'),
  body: text('body').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  search: tsvector('search').notNull().generatedAlwaysAs(sql`to_tsvector('simple'::regconfig, body)`),
}, t => [
  cardFk('card_comments_card_board_fk', t),
  // Target of the composite FK from comment_reactions.
  unique('card_comments_id_board_unique').on(t.id, t.boardId),
  index('card_comments_card_idx').on(t.cardId),
  index('card_comments_search_idx').using('gin', t.search),
  check('card_comments_imported_author', sql`${t.importedAuthor} is null or (${t.authorId} is null and length(${t.importedAuthor}) between 1 and 100)`),
])

// One row per person and emoji on a comment. The composite FK pins board_id to
// the comment's board, which the policies check. Emoji from shared/reactions.ts.
export const commentReactions = pgTable('comment_reactions', {
  commentId: uuid('comment_id').notNull(),
  boardId: uuid('board_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: createdAt(),
}, t => [
  primaryKey({ columns: [t.commentId, t.userId, t.emoji] }),
  foreignKey({ columns: [t.commentId, t.boardId], foreignColumns: [cardComments.id, cardComments.boardId], name: 'comment_reactions_comment_board_fk' }).onDelete('cascade'),
  check('comment_reactions_emoji_known', sql`${t.emoji} in (${sql.raw(reactionEmojis.map(e => `'${e}'`).join(', '))})`),
])

// Files live in Postgres so the same RLS policies guard downloads.
export const cardAttachments = pgTable('card_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  data: bytea('data').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  cardFk('card_attachments_card_board_fk', t),
  index('card_attachments_card_idx').on(t.cardId),
  check('card_attachments_size', sql`${t.size} between 0 and 10485760 and octet_length(${t.data}) = ${t.size}`),
])

// Time logged on a card. People log, edit and delete their own entries; board
// owners may delete anyone's (see 0029_card_schedule_time_rls.sql).
export const timeEntries = pgTable('time_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  // Null once the person's account is deleted.
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  minutes: integer('minutes').notNull(),
  spentOn: date('spent_on').notNull().default(sql`current_date`),
  note: text('note').notNull().default(''),
  createdAt: createdAt(),
}, t => [
  cardFk('time_entries_card_board_fk', t),
  index('time_entries_card_idx').on(t.cardId),
  check('time_entries_minutes_positive', sql`${t.minutes} > 0`),
])

// People who follow a card: they get the same notifications as its assignees.
// Everyone with board access watches and unwatches for themselves; card
// creators and commenters are added by triggers (see 0031_watchers_links_rls.sql).
export const cardWatchers = pgTable('card_watchers', {
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, t => [
  primaryKey({ columns: [t.cardId, t.userId] }),
  cardFk('card_watchers_card_board_fk', t),
  index('card_watchers_user_idx').on(t.userId),
])

// Directed link between two cards of the same board: from blocks / relates to /
// duplicates to. Both composite FKs pin the ends to board_id. A trigger rejects
// 'blocks' cycles (KB004). 'relates' is symmetric, so one row per pair.
export const cardLinks = pgTable('card_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull(),
  fromCardId: uuid('from_card_id').notNull(),
  toCardId: uuid('to_card_id').notNull(),
  kind: cardLinkKind('kind').notNull(),
  // Null once the creator's account is removed.
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  foreignKey({ columns: [t.fromCardId, t.boardId], foreignColumns: [cards.id, cards.boardId], name: 'card_links_from_board_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.toCardId, t.boardId], foreignColumns: [cards.id, cards.boardId], name: 'card_links_to_board_fk' }).onDelete('cascade'),
  unique('card_links_from_to_kind_unique').on(t.fromCardId, t.toCardId, t.kind),
  uniqueIndex('card_links_relates_pair').on(sql`least(${t.fromCardId}, ${t.toCardId})`, sql`greatest(${t.fromCardId}, ${t.toCardId})`).where(sql`${t.kind} = 'relates'`),
  index('card_links_to_idx').on(t.toCardId),
  check('card_links_not_self', sql`${t.fromCardId} <> ${t.toCardId}`),
])

// Custom card field of a board. options: select choices [{ id, label, color }]
// ('[]' for other kinds; shape checked by trigger, KB006). kind is fixed at
// creation (column-level UPDATE grant). See 0033_board_fields_rls.sql.
export const boardFields = pgTable('board_fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: boardFieldKind('kind').notNull(),
  options: jsonb('options').notNull().default([]),
  position: doublePrecision('position').notNull(),
  // Show the value on board cards.
  showOnCard: boolean('show_on_card').notNull().default(false),
  createdAt: createdAt(),
}, t => [
  unique('board_fields_id_board_id_unique').on(t.id, t.boardId),
  uniqueIndex('board_fields_board_name_unique').on(t.boardId, sql`lower(${t.name})`),
  check('board_fields_name_length', sql`char_length(${t.name}) between 1 and 50`),
])

// A card's value for one field. The value's JSON shape must match the field's
// kind (checked by trigger, KB005); no row = no value.
export const cardFieldValues = pgTable('card_field_values', {
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  fieldId: uuid('field_id').notNull(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.cardId, t.fieldId] }),
  cardFk('card_field_values_card_board_fk', t),
  foreignKey({ columns: [t.fieldId, t.boardId], foreignColumns: [boardFields.id, boardFields.boardId], name: 'card_field_values_field_board_fk' }).onDelete('cascade'),
  index('card_field_values_field_idx').on(t.fieldId),
])

// Schedule that creates a card from a template card in column_id
// (app.run_due_recurrences, server/tasks/cards/recurring.ts). One per template.
// weekly: weekdays (ISO, 1 = Monday) in every interval-th week; monthly:
// day_of_month (clamped to short months) every interval months. next_run_at is
// set by trigger when the schedule changes and advanced by each run. created_by
// is whoever last edited it: the cards are created as them.
export const cardRecurrences = pgTable('card_recurrences', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull(),
  templateCardId: uuid('template_card_id').notNull(),
  columnId: uuid('column_id').notNull(),
  rule: recurrenceRule('rule').notNull(),
  interval: integer('interval').notNull().default(1),
  weekdays: smallint('weekdays').array(),
  dayOfMonth: smallint('day_of_month'),
  // New cards are due this many days after they are created. Null = no due date.
  dueInDays: integer('due_in_days'),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
}, t => [
  unique('card_recurrences_template_unique').on(t.templateCardId),
  foreignKey({ columns: [t.templateCardId, t.boardId], foreignColumns: [cards.id, cards.boardId], name: 'card_recurrences_card_board_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.columnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'card_recurrences_column_board_fk' }).onDelete('cascade'),
  index('card_recurrences_due_idx').on(t.nextRunAt).where(sql`${t.active}`),
  check('card_recurrences_interval_range', sql`${t.interval} between 1 and 365`),
  check('card_recurrences_due_in_days_range', sql`${t.dueInDays} between 0 and 365`),
  check('card_recurrences_rule_fields', sql`case ${t.rule}::text
    when 'daily' then ${t.weekdays} is null and ${t.dayOfMonth} is null
    when 'weekly' then ${t.weekdays} is not null and cardinality(${t.weekdays}) between 1 and 7 and ${t.weekdays} <@ '{1,2,3,4,5,6,7}'::smallint[] and ${t.dayOfMonth} is null
    when 'monthly' then ${t.dayOfMonth} is not null and ${t.dayOfMonth} between 1 and 31 and ${t.weekdays} is null
    else false
  end`),
])

// Written only by triggers (see 0012_card_features_rls.sql); kanban_app can read it.
export const cardActivity = pgTable('card_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  data: jsonb('data').notNull().default({}),
  createdAt: createdAt(),
}, t => [
  cardFk('card_activity_card_board_fk', t),
  index('card_activity_card_idx').on(t.cardId, t.createdAt),
  // Board activity feed (GET /api/boards/:id/activity), keyset paginated.
  index('card_activity_board_idx').on(t.boardId, t.createdAt.desc(), t.id.desc()),
])

// One row per recipient of a card_activity entry. Written only by the
// app.fan_out_notification trigger (see 0016_notifications_rls.sql).
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  activityId: uuid('activity_id').notNull().references(() => cardActivity.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
}, t => [
  cardFk('notifications_card_board_fk', t),
  index('notifications_user_idx').on(t.userId, t.createdAt.desc()),
  index('notifications_user_unread_idx').on(t.userId).where(sql`${t.readAt} is null`),
])

export type BoardRole = (typeof boardRole.enumValues)[number]

// Personal access tokens (`Authorization: Bearer kb_...`, see 0041_api_tokens_webhooks_rls.sql).
// Only the sha256 of the token is stored; `prefix` (its first characters) is
// shown to tell tokens apart. Users manage their own; kanban_app cannot read
// token_hash. Requests resolve a token through app.resolve_api_token (kanban_auth).
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  // 'read' (GET/HEAD only) and/or 'write'.
  scopes: text('scopes').array().notNull(),
  // Boards the token may reach; null = every board the user can see. Not a
  // foreign key: a deleted board drops out without widening the token.
  boardIds: uuid('board_ids').array(),
  // Team bot tokens (0106_team_bots_rls.sql): only boards of this team, also
  // later ones. Deleted with the team (and its bots).
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // The token sealed with secretBox (0113_api_token_reveal_rls.sql), so its
  // owner (or a bot's manager) can see it again with a TOTP code through
  // app.reveal_api_token. kanban_app cannot read it; cleared on revoke.
  // Null for tokens made before 0112.
  tokenEnc: text('token_enc'),
  viewable: boolean('viewable').generatedAlwaysAs(sql`token_enc is not null`),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
}, t => [
  index('api_tokens_user_idx').on(t.userId),
  check('api_tokens_scopes', sql`${t.scopes} <@ array['read', 'write'] and cardinality(${t.scopes}) > 0`),
  check('api_tokens_board_ids', sql`${t.boardIds} is null or cardinality(${t.boardIds}) between 1 and 100`),
  check('api_tokens_one_limit', sql`${t.boardIds} is null or ${t.teamId} is null`),
])

export const webhookFormat = pgEnum('webhook_format', ['json', 'slack', 'discord'])

// Outgoing webhooks per board, managed by its owners. `secret` signs json
// payloads; kanban_app may write it but never read it back. Delivery state
// (last_*, failure_count, active after 20 failures in a row) is written by
// app.finish_webhook_delivery (kanban_auth).
export const boardWebhooks = pgTable('board_webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  format: webhookFormat('format').notNull().default('json'),
  secret: text('secret').notNull(),
  // Activity kinds to send; empty = all.
  events: text('events').array().notNull().default(sql`'{}'`),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  lastStatus: integer('last_status'),
  lastError: text('last_error'),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  failureCount: integer('failure_count').notNull().default(0),
}, t => [index('board_webhooks_board_idx').on(t.boardId)])

// Outbox: one row per webhook per activity, queued by a card_activity trigger
// and sent by server/utils/webhooks.ts (on NOTIFY and every minute). Up to 5
// attempts with backoff. No grants: only app.* functions touch it.
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id').notNull().references(() => boardWebhooks.id, { onDelete: 'cascade' }),
  activityId: uuid('activity_id').notNull().references(() => cardActivity.id, { onDelete: 'cascade' }),
  // pending | delivered | failed
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, t => [index('webhook_deliveries_due_idx').on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`)])

// Matrix room a board is connected to (see 0075_board_matrix_rooms_rls.sql).
// The bot's access token is sealed with secretBox (server/utils/matrix.ts);
// kanban_app may write it but never read it back, the server reads it through
// app.matrix_room_target. Board members read the rest, owners manage it.
export const boardMatrixRooms = pgTable('board_matrix_rooms', {
  boardId: uuid('board_id').primaryKey().references(() => boards.id, { onDelete: 'cascade' }),
  homeserverUrl: text('homeserver_url').notNull(),
  roomId: text('room_id').notNull(),
  roomName: text('room_name'),
  botUserId: text('bot_user_id').notNull(),
  accessToken: text('access_token').notNull(),
  // Post card activity into linked card threads (0079); activity kinds, empty = all.
  postActivity: boolean('post_activity').notNull().default(false),
  activityEvents: text('activity_events').array().notNull().default(sql`'{}'`),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// A board member's Matrix account on that board (see 0082_board_matrix_users_rls.sql).
// Pending while `code` is set: the user proves the Matrix ID by sending the
// code in the board's room; app.confirm_matrix_user then sets verified_at and
// clears the code. Replies from Kanso then mention the account silently.
// Dropped with the room connection.
export const boardMatrixUsers = pgTable('board_matrix_users', {
  boardId: uuid('board_id').notNull().references(() => boardMatrixRooms.boardId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mxid: text('mxid').notNull(),
  code: text('code').default(sql`upper(substr(md5(gen_random_uuid()::text), 1, 10))`),
  codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }).default(sql`now() + interval '15 minutes'`),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: createdAt(),
}, t => [
  primaryKey({ columns: [t.boardId, t.userId] }),
  uniqueIndex('board_matrix_users_mxid_idx').on(t.boardId, t.mxid).where(sql`${t.verifiedAt} IS NOT NULL`),
])

// Outbox: one row per card activity to post into the card's Matrix thread,
// queued by a card_activity trigger and sent by server/utils/matrixActivity.ts
// (on NOTIFY and every minute). Up to 5 attempts. No grants.
export const matrixDeliveries = pgTable('matrix_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  activityId: uuid('activity_id').notNull().references(() => cardActivity.id, { onDelete: 'cascade' }),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  // pending | delivered | failed
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, t => [index('matrix_deliveries_due_idx').on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`)])

// Matrix thread a card is linked to (see 0077_card_matrix_threads_rls.sql):
// the root event of a thread in the board's Matrix room at link time.
// Members read it, editors link and unlink; the server fills room and event
// after the bot posted or checked them.
export const cardMatrixThreads = pgTable('card_matrix_threads', {
  cardId: uuid('card_id').primaryKey(),
  boardId: uuid('board_id').notNull(),
  roomId: text('room_id').notNull(),
  eventId: text('event_id').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [cardFk('card_matrix_threads_card_board_fk', t)])

// Web Push: one row per browser that turned push on (see 0068_push_rls.sql).
// Tied to the sign-in session that subscribed: revoking or deleting the session
// deletes the subscription, so a signed-out device gets nothing. Written only
// through app.save_push_subscription (moves an endpoint between users when
// someone else signs in on the same browser); users read and delete their own.
// kanban_app cannot read the encryption keys.
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull().references(() => userSessions.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  failureCount: integer('failure_count').notNull().default(0),
}, t => [
  index('push_subscriptions_user_idx').on(t.userId),
  index('push_subscriptions_session_idx').on(t.sessionId),
  check('push_subscriptions_endpoint', sql`${t.endpoint} ~ '^https?://' and char_length(${t.endpoint}) <= 2000`),
  check('push_subscriptions_keys', sql`char_length(${t.p256dh}) between 80 and 100 and char_length(${t.auth}) between 16 and 40`),
])

// Outbox: one row per notification of a user with push subscriptions, queued by
// a notifications trigger and sent by server/utils/push.ts (on NOTIFY and every
// minute). No grants: only app.* functions touch it.
export const pushMessages = pgTable('push_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  notificationId: uuid('notification_id').notNull().unique().references(() => notifications.id, { onDelete: 'cascade' }),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, t => [index('push_messages_due_idx').on(t.nextAttemptAt)])

// Per-member access limits on a board (see 0088_board_member_access_rls.sql).
// A row here marks a non-owner as limited on the board: access to each card is
// the card's entry in board_member_access, else its column's entry, else
// default_access, capped by the person's role (viewers at most read). Limited
// people cannot change the board's structure (app.can_edit is false for them).
// No row = today's role-based access. Owners manage both tables.
export const boardAccess = pgEnum('board_access', ['none', 'read', 'edit'])

export const boardMemberLimits = pgTable('board_member_limits', {
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  defaultAccess: boardAccess('default_access').notNull().default('none'),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.boardId, t.userId] }), index('board_member_limits_user_idx').on(t.userId)])

export const boardMemberAccess = pgTable('board_member_access', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull(),
  userId: uuid('user_id').notNull(),
  columnId: uuid('column_id'),
  cardId: uuid('card_id'),
  access: boardAccess('access').notNull(),
}, t => [
  foreignKey({ columns: [t.boardId, t.userId], foreignColumns: [boardMemberLimits.boardId, boardMemberLimits.userId], name: 'board_member_access_limit_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.columnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'board_member_access_column_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.cardId, t.boardId], foreignColumns: [cards.id, cards.boardId], name: 'board_member_access_card_fk' }).onDelete('cascade'),
  check('board_member_access_target', sql`num_nonnulls(${t.columnId}, ${t.cardId}) = 1`),
  uniqueIndex('board_member_access_column_unique').on(t.boardId, t.userId, t.columnId).where(sql`${t.columnId} is not null`),
  uniqueIndex('board_member_access_card_unique').on(t.boardId, t.userId, t.cardId).where(sql`${t.cardId} is not null`),
])
