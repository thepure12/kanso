import { sql } from 'drizzle-orm'
import { type AnyPgColumn, boolean, check, customType, date, doublePrecision, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

const citext = customType<{ data: string }>({ dataType: () => 'citext' })
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

import type { BoardBackground } from '../../shared/boardBackgrounds'
import { type BoardAccent, boardAccents } from '../../shared/boardAccents'
import type { ColumnOutline } from '../../shared/columnOutline'

// Shape of a column outline (shared/columnOutline.ts): exactly color, width, glow.
const outlineShape = (c: AnyPgColumn) => sql`${c} is null or (
    jsonb_typeof(${c}) = 'object'
    and ${c} ?& array['color', 'width', 'glow']
    and ${c} - 'color' - 'width' - 'glow' = '{}'::jsonb
    and (${c}->'color' = 'null'::jsonb or ${c}->>'color' in ('accent', 'column') or ${c}->>'color' ~ '^#[0-9a-f]{6}$')
    and ${c}->'width' in ('1', '2', '3', '4')
    and ${c}->'glow' in ('0', '1', '2', '3'))`

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const boardRole = pgEnum('board_role', ['owner', 'editor', 'viewer'])

export const columnRuleKind = pgEnum('column_rule_kind', ['apply_tag', 'assign_to', 'remove_tag', 'set_due', 'assign_mover'])

export const signupMode = pgEnum('signup_mode', ['open', 'restricted'])

export const cardPriority = pgEnum('card_priority', ['low', 'medium', 'high', 'urgent'])

export const cardLinkKind = pgEnum('card_link_kind', ['blocks', 'relates', 'duplicates'])

export const boardFieldKind = pgEnum('board_field_kind', ['text', 'number', 'date', 'select', 'checkbox', 'url'])

export const recurrenceRule = pgEnum('recurrence_rule', ['daily', 'weekly', 'monthly'])

export const boardAutomationKind = pgEnum('board_automation_kind', ['archive_done', 'tag_stale', 'notify_stale', 'raise_priority'])

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
  createdAt: createdAt(),
})

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
  createdAt: createdAt(),
}, t => [
  check('boards_background_shape', sql`${t.background} is null
    or (${t.background}->>'kind' = 'color' and ${t.background}->>'value' ~ '^#[0-9a-f]{6}$')
    or (${t.background}->>'kind' in ('gradient', 'photo', 'upload') and ${t.background}->>'value' ~ '^[a-z0-9-]{1,40}$')`),
  check('boards_accent_known', sql`${t.accent} is null or ${t.accent} in (${sql.raw(boardAccents.map(a => `'${a}'`).join(', '))})`),
  check('boards_column_outline_shape', outlineShape(t.columnOutline)),
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
  // CARD_TITLE_MAX (shared/cards.ts).
  check('cards_title_length', sql`char_length(${t.title}) <= 1000`),
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
// The check compares kind::text so a migration that adds a kind can use it in the same transaction.
export const columnRules = pgTable('column_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull(),
  columnId: uuid('column_id').notNull(),
  kind: columnRuleKind('kind').notNull(),
  tagId: uuid('tag_id'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  dueDays: integer('due_days'),
  createdAt: createdAt(),
}, t => [
  unique('column_rules_column_kind_tag_unique').on(t.columnId, t.kind, t.tagId),
  unique('column_rules_column_kind_user_unique').on(t.columnId, t.kind, t.userId),
  foreignKey({ columns: [t.columnId, t.boardId], foreignColumns: [columns.id, columns.boardId], name: 'column_rules_column_board_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.tagId, t.boardId], foreignColumns: [tags.id, tags.boardId], name: 'column_rules_tag_board_fk' }).onDelete('cascade'),
  // At most one set_due rule per column (due_days is set only on set_due rules, check below).
  uniqueIndex('column_rules_one_due_per_column').on(t.columnId).where(sql`${t.dueDays} is not null`),
  // At most one assign_mover rule per column (the only kind with no tag, user or days).
  uniqueIndex('column_rules_one_mover_per_column').on(t.columnId).where(sql`${t.tagId} is null and ${t.userId} is null and ${t.dueDays} is null`),
  check('column_rules_kind_fields', sql`case ${t.kind}::text
    when 'apply_tag' then ${t.tagId} is not null and ${t.userId} is null and ${t.dueDays} is null
    when 'remove_tag' then ${t.tagId} is not null and ${t.userId} is null and ${t.dueDays} is null
    when 'assign_to' then ${t.userId} is not null and ${t.tagId} is null and ${t.dueDays} is null
    when 'set_due' then ${t.dueDays} between 0 and 365 and ${t.tagId} is null and ${t.userId} is null
    when 'assign_mover' then ${t.tagId} is null and ${t.userId} is null and ${t.dueDays} is null
    else false
  end`),
])

// Time-based automations of a board, run hourly by app.run_board_automations()
// (server/tasks/cards/automations.ts). See 0056_board_automations_rls.sql.
// archive_done: archives cards that have been in the last column for `days` days.
// tag_stale: adds tag_id to open cards (not in the last column) without activity for `days` days.
// notify_stale: logs `stale` on such cards, so assignees and watchers are notified.
// raise_priority: raises open cards due within `days` days (or overdue) to `priority`.
export const boardAutomations = pgTable('board_automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  kind: boardAutomationKind('kind').notNull(),
  days: integer('days').notNull(),
  tagId: uuid('tag_id'),
  priority: cardPriority('priority'),
  active: boolean('active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: createdAt(),
}, t => [
  unique('board_automations_unique').on(t.boardId, t.kind, t.tagId, t.priority).nullsNotDistinct(),
  foreignKey({ columns: [t.tagId, t.boardId], foreignColumns: [tags.id, tags.boardId], name: 'board_automations_tag_board_fk' }).onDelete('cascade'),
  check('board_automations_kind_fields', sql`case ${t.kind}::text
    when 'archive_done' then ${t.days} between 1 and 365 and ${t.tagId} is null and ${t.priority} is null
    when 'tag_stale' then ${t.days} between 1 and 365 and ${t.tagId} is not null and ${t.priority} is null
    when 'notify_stale' then ${t.days} between 1 and 365 and ${t.tagId} is null and ${t.priority} is null
    when 'raise_priority' then ${t.days} between 0 and 365 and ${t.priority} is not null and ${t.tagId} is null
    else false
  end`),
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

export const checklistItems = pgTable('checklist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull(),
  boardId: uuid('board_id').notNull(),
  text: text('text').notNull(),
  done: boolean('done').notNull().default(false),
  position: doublePrecision('position').notNull(),
  createdAt: createdAt(),
}, t => [
  cardFk('checklist_items_card_board_fk', t),
  index('checklist_items_card_idx').on(t.cardId),
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
  index('card_comments_card_idx').on(t.cardId),
  index('card_comments_search_idx').using('gin', t.search),
  check('card_comments_imported_author', sql`${t.importedAuthor} is null or (${t.authorId} is null and length(${t.importedAuthor}) between 1 and 100)`),
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
  createdAt: createdAt(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, t => [
  index('api_tokens_user_idx').on(t.userId),
  check('api_tokens_scopes', sql`${t.scopes} <@ array['read', 'write'] and cardinality(${t.scopes}) > 0`),
  check('api_tokens_board_ids', sql`${t.boardIds} is null or cardinality(${t.boardIds}) between 1 and 100`),
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
