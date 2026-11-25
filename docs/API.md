# Kanso HTTP API

Everything the web app does goes through the JSON API under `/api`. Scripts and integrations use it with a
**personal access token**. Postgres row-level security applies to token requests exactly as to the browser:
a token can see and do what its owner can, nothing more.

## Authentication

Create a token on the **Account** page (**API tokens**, **New token**). The server keeps its SHA-256 and a copy
sealed with AES-256-GCM, so the eye button next to a live token shows it again after a code from your authenticator
app (two-factor must be on; recovery codes do not count). Bot tokens work the same for whoever manages the bot.
Revoking a token drops the sealed copy. Send it as a Bearer token:

```bash
export KANSO=https://kanso.example.com
export TOKEN=kb_...
curl -H "Authorization: Bearer $TOKEN" $KANSO/api/boards
```

When the instance runs under a sub-path, include it in the base URL (`KANSO=https://example.org/kanso`).

- **Scopes**: *Read only* tokens may only send `GET` and `HEAD` (anything else is `403`). *Read and write* tokens may
  call every allowed route.
- **Boards**: a token reaches every board its owner can see, or only the boards chosen at creation. A limited token
  sees nothing of other boards (`404`), lists only its boards, cannot create boards or teams (`403`) and acts as a
  team viewer at most (no renaming, member changes or leaving). Deleting a board or losing access to it never widens
  the token.
- **Allowed routes**: boards, cards, columns, tags, comments, checklists, checklist items, column rules, board automations, board rules, agent rules, scheduled card actions, attachments, card links,
  fields, column groups, time entries, teams, notifications, search, `/api/me` (`{id, name, email, isBot, isAdmin, locale}`: who the token acts as) and the event stream `/api/events`. Account, sign-in, two-factor, session, token,
  admin and webhook routes refuse tokens (`403`, or `401` for routes that only take the session cookie), so a leaked
  token cannot take over the account.
- **Lifetime**: tokens work until revoked on the Account page, until they expire (30 days, 90 days, 1 year or never,
  chosen at creation), or until the account's password is **reset** through the forgot-password link. Changing the
  password while signed in, signing in elsewhere or turning on two-factor leaves them working. Deleting the account
  deletes them.
- Unknown, revoked and expired tokens get `401`. More than 20 failed token attempts from one IP within 15 minutes
  get `429`.
- A request with an `Authorization: Bearer` header is authenticated by the token only; cookies are ignored and none
  are set. No CSRF token is needed.

Errors come back as JSON with `statusCode` and `statusMessage`: `400` invalid input, `401` not authenticated,
`403` not allowed, `404` not found (or not visible to you), `409` conflict, `429` rate limited.

## Main routes

| Method | Path | What |
| --- | --- | --- |
| GET | `/api/boards` | Boards you can see |
| POST | `/api/boards` | Create a board `{ name, teamId?, template? }` (`basic`, `scrum`, `bugs`, `empty`) |
| GET | `/api/boards/:id` | Board with columns, column groups, cards, tags, fields, members and your `role` |
| PATCH / DELETE | `/api/boards/:id` | Rename `{ name }` / delete (owners) |
| PUT | `/api/boards/:id/notifications` | Your notifications from this board `{ level: 'all' \| 'direct' \| 'none' }` (`direct` = mentions and being assigned); shown as `notificationLevel` on the board |
| GET | `/api/boards/:id/export?format=json\|csv` | Export |
| GET | `/api/boards/:id/activity?before=&limit=` | Activity feed, newest first (cursor paginated) |
| POST | `/api/boards/:id/columns` | Add a column `{ title, groupId? }` (`groupId` also adds it to that column group) |
| PATCH / DELETE | `/api/columns/:id` | Edit / delete a column |
| POST | `/api/boards/:id/column-groups` | Add a column group (called a column tag in the UI) `{ name, color?, columnIds? }` (editors) |
| PATCH / DELETE | `/api/column-groups/:id` | Edit `{ name?, color?, columnIds?, aboveId?, belowId? }` (`columnIds` replaces the members) / delete a group (its columns stay) |
| POST | `/api/boards/:id/assignee-groups` | Add an assignee group (named set of board members) `{ name, userIds? }` (editors; members need board access, else 403). Assigning a group = adding its `userIds` as assignees |
| PATCH / DELETE | `/api/assignee-groups/:id` | Edit `{ name?, userIds? }` (`userIds` replaces the members) / delete a group (cards keep their assignees) |
| POST | `/api/boards/:id/saved-views` | Save a view `{ name, shared?, config: { view, groupBy, columnGroupId, filter } }`: personal (anyone with access) or `shared: true` on the board (editors); a taken name is `409`. Listed as `savedViews` on the board (shared ones and your own) |
| PATCH / DELETE | `/api/saved-views/:id` | Rename / replace the settings `{ name?, config? }` / delete a saved view |
| POST | `/api/boards/:id/buttons` | Create a button `{ scope: card|board, name, icon?, color?, tooltip?, shared?, columnIds?, steps }` (`tooltip`: optional hover text up to 200 characters, blank or null = none; `color`: `accent`, the board's accent colour and the default, or a lower-case `#rrggbb`; `columnIds`: card buttons only, the columns whose cards offer it; null/absent = every column, `[]` = none, only the cards it is added to): personal (anyone with access) or `shared: true` (editors); a taken name is `409`. Card steps: `move {columnId}`, `addTag`/`removeTag {tagId}`, `assignMe`, `unassignMe`, `assign {userId}`, `setDue {inDays|null}`, `setPriority {priority|null}`, `addChecklist {items}`, `archive`, `watch`; board steps: `archiveColumn {columnId}`, `sortColumn {columnId, by: priority|due|title}`, `moveColumnCards {from, to}` (1-10 steps). Listed as `buttons` on the board |
| PUT | `/api/boards/:id/button-align` | Where card buttons sit in their row on cards and in the card dialog `{ align: left|center|right|null }` (null = left; owners, else `404`). Returned as `buttonAlign` on the board |
| PATCH / DELETE | `/api/buttons/:id` | Change `{ name?, icon?, color?, tooltip?, columnIds?, steps? }` / delete a button |
| PUT / DELETE | `/api/buttons/:id/cards/:cardId` | Add a card button to one card / take it off: the card offers it whatever the button's columns (own personal buttons, or shared ones as an editor of the card, else `403`; not templates). Returns the button; `cardIds` lists its cards |
| POST | `/api/buttons/:id/run` | Run a button as you `{ cardId? }` (card buttons need the card, in one of the button's columns or added to it, else `409`): all steps or none (`403`/`404` when one is refused); returns `{ skipped }`, the steps whose column, tag or person is gone |
| POST | `/api/boards/:id/automations` | Add a time-based automation (editors, checked hourly): `{ kind: 'archive_done' \| 'notify_stale', days }` (1-365), `{ kind: 'tag_stale', days, tagId }` or `{ kind: 'raise_priority', days, priority }` (days 0-365), each with an optional `columnId` (only the cards in that column, the last column too; `archive_done` then counts the days in it) or `cardId` (only that card, also when it skips automations; not both, `400`); `{ kind: 'move_card', days, columnId \| cardId, targetColumnId }` moves cards after `days` in `columnId` (or the card's current column) to the end of `targetColumnId` (column rules run; one per column or card); the same one twice is `409` |
| PATCH / DELETE | `/api/automations/:id` | Edit `{ days?, active? }` / delete an automation |
| POST | `/api/boards/:id/rules` | Add an event-triggered rule (editors): `{ event, eventTagId?, eventUserId?, conditions?: { tagId?, priority?, columnId?, assigneeId? }, actions: { moveColumnId?, addTagId?, removeTagId?, assignUserId?, priority?, dueDays?, archive? } }`. Events: `card_created`, `card_moved`, `tag_added` (`eventTagId` narrows it), `assigned` (`eventUserId`), `due_set`, `checklist_completed`, `card_completed` (marked complete), `commented`. All given conditions must hold; at least one action (`400`). Rules run when the triggering change is saved, without an actor; their own changes trigger no rules. Listed as `rules` on the board |
| PATCH / DELETE | `/api/board-rules/:id` | Replace a rule (same body; omitted conditions/actions are cleared) or only `{ active }` / delete it |
| GET / POST | `/api/boards/:id/agent-rules` | Agent rules, followed by `kanso agent run --board` with the bot's token ([CLI.md](CLI.md#agent-rules)). POST (editors): `{ name, botId, event, columnId?, tagId?, instructions, moveColumnId?, comment?: 'never' \| 'failure' \| 'always', settleSeconds?: 0-3600 \| null }`. `settleSeconds`: how long the card must stay unchanged before the runner starts (null = the runner's `--settle`, else 60 for `card_created`/`card_moved`/`tag_added`, 0 for `assigned`/`mentioned`). Events: `card_created`, `card_moved`, `tag_added`, `assigned` (the bot), `mentioned` (the bot). `columnId`: the card is (moved) in that column; `tagId`: the card carries it (for `tag_added`: it is the added tag). `botId` must be a bot with access to the board (`403`). Everyone on the board reads them (members with limited access only their own bot's); also `agentRules` on the board |
| PATCH / DELETE | `/api/agent-rules/:id` | Replace an agent rule (same body) or only `{ active }` / delete it |
| POST | `/api/cards/:id/scheduled-actions` | Schedule a one-shot action for `runOn` (YYYY-MM-DD; run by the hourly automations task, then deleted; editors): `{ kind: 'move', runOn, targetColumnId }`, `{ kind: 'archive', runOn }`, `{ kind: 'priority', runOn, priority }` or `{ kind: 'remind', runOn, note? }` (notifies assignees and watchers, note up to 500 characters). Listed as `scheduledActions` on the board |
| DELETE | `/api/scheduled-actions/:id` | Delete a scheduled action |
| POST | `/api/cards/:id/reminders` | Personal reminder for you only (anyone who can see the card, viewers too): `{ at, note? }` (ISO time with offset) or `{ beforeDueDays, time, timeZone, note? }` (0-365 days before the due date, `HH:MM` in an IANA zone; waits while the card has no due date, follows due date changes). A time that has passed is refused (400). Sent within a minute as a notification; listed as `reminders` by `GET /api/cards/:id` |
| DELETE | `/api/reminders/:id` | Delete one of your reminders |
| POST | `/api/boards/:id/cards` | Add a card `{ columnId, title, description? }` (title up to 1000 characters) |
| GET | `/api/cards/:id` | Card with checklists, comments, attachments, links and activity |
| PATCH | `/api/cards/:id` | Edit `{ title?, description?, startDate?, dueDate?, priority?, estimate?, tagIds?, assigneeIds?, archived?, completed?, skipAutomations?, snoozedUntil? }` (`completed`: mark the card complete without moving it (`completedAt` on cards), `false` opens it again; `skipAutomations`: board and column automations leave the card alone; `snoozedUntil` YYYY-MM-DD hides the card from the board until that day, `null` brings it back) |
| GET | `/api/boards/:id/snoozed` | Snoozed cards `[{ id, columnId, title, snoozedUntil }]`, next to wake first |
| POST | `/api/boards/:id/cards/bulk` | Change up to 200 cards at once, all or none `{ cardIds, columnId?, archived?, priority?, dueDate?, addTagIds?, removeTagIds?, addAssigneeIds?, removeAssigneeIds? }`; `columnId` moves them to the end of that column in board order. Returns `{ cards }` (those not archived) |
| POST | `/api/cards/:id/move` | Move `{ columnId, aboveId, belowId }` (neighbour card ids in the target column, `null` = start/end) |
| DELETE | `/api/cards/:id` | Move a card to the board's trash (deleted for good after 30 days) |
| POST | `/api/cards/:id/restore` | Bring a card back from the trash |
| GET | `/api/boards/:id/trash` | Trashed cards, newest first (editors) |
| DELETE | `/api/boards/:id/trash` | Empty the trash; `/api/boards/:id/trash/:cardId` deletes one card for good |
| POST | `/api/cards/:id/comments` | Comment `{ body }` (Markdown) |
| PUT / DELETE | `/api/comments/:id/reactions` | Add or remove your reaction `{ emoji }` (one of 👍 👎 😄 🎉 😕 ❤️ 🚀 👀); returns the comment's reactions |
| POST | `/api/cards/:id/checklists` | Add a named checklist `{ name }` (1-100 characters) at the end |
| PATCH / DELETE | `/api/checklists/:id` | Rename `{ name }` or reorder `{ aboveId, belowId }` a checklist; delete it with its items |
| POST | `/api/cards/:id/checklist` | Add a checklist item `{ text, checklistId?, assigneeId?, dueDate? }`; without `checklistId` it goes into the card's first checklist (one named "Checklist" is created when there is none); the assignee must be able to see the card, else `403`, and is notified |
| PATCH / DELETE | `/api/checklist-items/:id` | Change `{ text, done, assigneeId?, dueDate? }` (null clears), move `{ checklistId?, aboveId?, belowId? }` (to another checklist of the card: at its end without neighbours), or delete an item |
| POST | `/api/boards/:id/members` | Share `{ email, role }` (owners; role `owner`, `editor`, `commenter` or `viewer`) |
| GET | `/api/teams`, `/api/teams/:id` | Teams and a team's boards and members |
| GET | `/api/search?q=` | Search cards, comments, boards and columns |
| GET | `/api/notifications` | Your notifications, newest first: `?limit=` (1-100, default 50), `?before=<nextCursor>` for the next page, `?unread=1`, `?boardId=`, `?event=` (`assigned`, `mentioned`, `commented`, `moved`, `due`, `archived`, `stale`, `reminder`). Also `unread` (overall), `boards` (with unread counts) and `dueSoon` |
| PATCH | `/api/notifications/:id` | `{ read: boolean }` marks read or unread |
| DELETE | `/api/notifications/:id` | Removes it from your inbox |
| POST | `/api/notifications/read-all` | Marks all read (`?boardId=` for one board) |
| POST | `/api/notifications/clear-read` | Deletes read notifications (`?boardId=` for one board) |
| GET | `/api/my-work` | Cards assigned to you or that you watch, on all boards (`assigned`, `watching`, `done` flags, `assignees`). Optional filters: `people=involved\|assigned\|watching\|anyone\|people` (default `involved`; `people` with repeated `user=<id>`), repeated `column=<title>` and `tag=<name>` (case-insensitive, every board), `board=<id>`, `priority=<p>\|none` |
| GET/POST | `/api/my-work/panels` | Your saved My work panels `{name, config}` (`shared/myWork.ts`); `PATCH`/`DELETE /api/my-work/panels/:id`, `PUT /api/my-work/panels/order {ids}` |
| GET | `/api/my-work/options` | Boards, column titles, card tag names and people for the panel editor |

Dates are `YYYY-MM-DD`; timestamps are ISO 8601. The types of responses live in `shared/types/`.

## Examples

```bash
# Boards and one board's cards
curl -s -H "Authorization: Bearer $TOKEN" $KANSO/api/boards
curl -s -H "Authorization: Bearer $TOKEN" $KANSO/api/boards/$BOARD | jq '.cards[] | {id, title}'

# Add a card to a column (needs a read and write token)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"columnId":"'$COLUMN'","title":"Deploy 1.4"}' $KANSO/api/boards/$BOARD/cards

# Set its due date and move it to the end of another column
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"dueDate":"2026-11-01"}' $KANSO/api/cards/$CARD
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"columnId":"'$DONE'","aboveId":null,"belowId":null}' $KANSO/api/cards/$CARD/move
```

## MCP (AI agents)

`POST /api/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server (Streamable HTTP, stateless,
JSON responses) for agents such as Claude Code or Claude Desktop. It takes an API token only (`Authorization: Bearer`,
never the session cookie; `401` without one) and acts as the token's user: each tool calls the routes above, so the
same permissions, validation and scope rules apply, and changes show up live on open boards. `GET` and `DELETE` are
`405`.

- **Read tools** (every token): `list_boards`, `get_board` (columns with their cards and colours, card tags, column
  tags, automations, rules, scheduled card actions, accent, members, fields, templates),
  `get_card` (description, checklists with their items, comments, links, attachments, recent activity), `search`, `my_work`,
  `list_notifications`.
- **Write tools** (listed only for read and write tokens): `create_card`, `update_card`, `move_card`,
  `bulk_update_cards`, `add_comment`, `link_cards` (blocks, relates, duplicates), `create_checklist`, `add_checklist_item`, `update_checklist_item`; board structure:
  `create_column`, `update_column` (title, description, colour, WIP limit, order), `create_tag`, `update_tag`, `create_column_tag`,
  `update_column_tag` (name, colour, columns), `create_assignee_group`, `update_assignee_group` (name, members), `create_automation` (board, column or card), `update_automation`, `create_rule`, `update_rule`, `schedule_card_action`, `set_board_accent`,
  `mark_notifications_read` (given ids, or all). There are no delete tools for these.
- API errors come back as tool results with `isError` and the status, e.g. `404 Board not found`.

```bash
# Claude Code (the Account page shows this command when you create a token)
claude mcp add --transport http kanso $KANSO/api/mcp --header "Authorization: Bearer $TOKEN"
```

Other clients: add a remote HTTP MCP server with URL `$KANSO/api/mcp` and the header above. A read-only token is
enough for an agent that only reports on boards.

## Board bots

A bot is a member of one board with its own name, made for agents and scripts that should not act as a person. Board
owners add, rename and delete bots and make their tokens; everyone on the board sees them as members (`isBot: true`
in `GET /api/boards/:id` → `members`, and in `bots`). A bot's role is editor, commenter or viewer, never owner. It
cannot sign in, join another board or a team, and is only removed by deleting it (or its board).

| Method | Path | Body | Who |
|---|---|---|---|
| `GET` | `/api/boards/:id/bots` | | everyone on the board; `tokens` only for owners (else `null`) |
| `POST` | `/api/boards/:id/bots` | `{name, role?}` (role default `editor`) | owners |
| `PATCH` | `/api/bots/:id` | `{name?, role?}` | owners |
| `DELETE` | `/api/bots/:id` | | owners; its tokens stop working, its cards and comments stay with no author |
| `POST` | `/api/bots/:id/tokens` | `{name, scopes: ["read"] \| ["read","write"], expiresInDays?}` | owners; the `kb_...` token is in this response only |
| `DELETE` | `/api/bots/:id/tokens/:tokenId` | | owners; revokes it |
| `POST` | `/api/bots/:id/avatar` | multipart, one `file` part (PNG, JPEG, WebP or GIF, 1 MB) | owners; sets its picture, returns the bot |
| `DELETE` | `/api/bots/:id/avatar` | | owners; removes its picture |

These routes take the session cookie only: an API token (a bot's or a person's) gets `403`, so a token can never make
more tokens. A bot token is always limited to the bot's board and works like any other token on every route above and
on `/api/mcp`: the agent acts as the bot (activity shows its name), within the bot's role and the token's scopes.

Owners can also limit a bot to some columns and cards, like any other member: `PUT /api/boards/:id/members/:botId/access
{defaultAccess, columns, cards}` (`DELETE` lifts it; in the UI the shield button in the Bots or Members panel). A
limited bot sees only the columns and cards it may read and changes only those it may edit, through the API and MCP.

```bash
# As a board owner in the browser session; then hand $TOKEN to the agent
curl -s -X POST -b "$COOKIE" -H 'content-type: application/json' \
  -d '{"name":"Claude","role":"editor"}' $KANSO/api/boards/$BOARD/bots
curl -s -X POST -b "$COOKIE" -H 'content-type: application/json' \
  -d '{"name":"ci","scopes":["read","write"]}' $KANSO/api/bots/$BOT/tokens
```

### Team bots

A team bot is the same for a whole team: a team member (editor, commenter or viewer) that reaches every board of the
team, boards made later included, with its team role. Team owners manage team bots on the team page (team menu →
Bots); team members see them in `GET /api/teams/:id` (`members` with `isBot: true`, and `bots`) and on the team's
boards as members through the team (`teamRole`, no `boardRole`). A team bot cannot join another team, get a board
membership of its own or leave the team; deleting the team deletes its bots.

| Method | Path | Body | Who |
|---|---|---|---|
| `GET` | `/api/teams/:id/bots` | | team members; `tokens` only for team owners (else `null`) |
| `POST` | `/api/teams/:id/bots` | `{name, role?}` (role default `editor`) | team owners |

`PATCH`/`DELETE /api/bots/:id` and the token routes above work for team bots too (team owners). A team bot's token
is limited to the team: it reaches only the team's boards and keeps the bot's team role there (a board-limited token
would act as a team viewer at most). It cannot create boards or teams. Cookie only, like the board bot routes.

### Account bots

An account bot belongs to a person instead of a board or team (at most 20 each). Its owner makes it on `/account`
(Bots tab) and adds it to boards they own, as editor, commenter or viewer (never owner), either there or in the
board's members form, where the owner's own bots show up in the suggestions. Nobody else can add it anywhere. Board
owners change its role or remove it like any member (`PATCH`/`DELETE /api/boards/:id/members/:userId`); its owner can
also take it off a board. It never joins a team. Deleting the owner's account deletes their bots; losing ownership of
a board leaves the bot there.

| Method | Path | Body | Who |
|---|---|---|---|
| `GET` | `/api/account/bots` | | the caller's bots, with `tokens` and `boards` (`{id, name, role, owner}`) |
| `POST` | `/api/account/bots` | `{name}` | signed-in people (409 past 20) |
| `PUT` | `/api/account/bots/:id/boards/:boardId` | `{role}` | the bot's owner, on boards they own |
| `DELETE` | `/api/account/bots/:id/boards/:boardId` | | the bot's owner |

`PATCH /api/bots/:id {name}` (no `role`: it is per board), `DELETE /api/bots/:id`, the avatar and the token routes
above work for account bots too (their owner only). An account bot's token has no board or team limit: it reaches
exactly the boards the bot is on at the time, with the bot's role there. It cannot create boards, teams or bots.

### Driving an agent from mentions

Give the agent a board, team or account bot's token. Bots get inbox notifications like people (no push, email or digest): when
someone mentions the bot in a comment (`@Name`), assigns it to a card or a checklist item, or comments on or moves a
card it is assigned to or watches. A bot does not start watching cards it creates or comments on, so its own replies
do not subscribe it to the whole board; it can watch one explicitly (`PUT /api/cards/:id/watch`).

A simple loop: call `list_notifications` (or `GET /api/notifications`) every few minutes, handle each unread item
(`cardId`, `boardId`, `activity.kind`: `commented` with the bot in `activity.data.mentions`, `mentioned`, `assigned`,
...; read the card with `get_card`), reply with `add_comment`, then `mark_notifications_read` with the handled ids
(`PATCH /api/notifications/:id {read: true}`; `POST /api/notifications/read-all` for all) so the next poll shows only
new ones.

Instead of polling, open the event stream with `notifications=1` (see [Event stream](#event-stream)) and fetch the
inbox when a `notifications` event arrives.

`kanso agent run --notifications --cmd ...` (see [CLI.md](CLI.md#kanso-agent-run)) does all of this: it follows the
stream, runs a command per unread notification with the card on stdin and marks it read afterwards.

## Event stream

`GET /api/events` is a server-sent event stream (`text/event-stream`). Browsers use it with the session cookie; scripts
and agents use any token (`Authorization: Bearer`, read scope is enough). Nothing needs to reach the listener: it opens
the connection itself, so it works from a workstation without an open port, and it simply reconnects after a drop.

Query parameters (comma-separated lists):

| Parameter | What |
| --- | --- |
| `boards` | Board ids to follow (up to 50) |
| `notifications=1` | Send `notifications` whenever you (or the bot) get a notification |
| `activity` | Activity kinds to send as `activity` events (`created`, `moved`, `commented`, `assigned`, ... the same kinds as webhook events) |
| `columns` | Only activity of cards (now) in these columns (up to 200); for `moved`, the column the card landed in. Without it, every column |
| `clients` | Your client ids (up to 50, `[A-Za-z0-9_-]`, 1-64 characters). Requests sent with `x-client-id: <id>` are yours: `activity` leaves them out, `change` names them in `c` |
| `change` | `1` or `0`: send `change` events. Default: on, off once `activity` is given |

Events:

- `activity` `{a, b, card, kind, column}`: activity entry `a` of card `card` on board `b`. Ids only; fetch the card
  (`GET /api/cards/:id`) for details. Only entries you may read are sent: members limited to some columns or cards,
  and bots, never hear about cards they cannot see. Personal reminders are not sent.
- `change` `{b, c}`: something on board `b` changed (bursts within 250 ms are one event).
- `notifications`: your inbox changed; read it with `GET /api/notifications`.
- `gone` `{b}`: you cannot see board `b` (outside the token's boards, never shared, or access lost); it is dropped.
- `ready` once everything is subscribed, `ping` at once and every 25 s.

The token is checked again every 25 s; once it is revoked or expired the server closes the stream (reconnecting then
gets `401`). A reverse proxy in front of Kanso must allow idle reads longer than 25 s.

```bash
# New and moved cards in two columns, without the listener's own changes
curl -N -H "Authorization: Bearer $TOKEN" \
  "$KANSO/api/events?boards=$BOARD&activity=created,moved&columns=$TODO,$BUGS&clients=my-worker"
```

## Webhooks

Board owners add webhooks from the board menu (**Webhooks**). Each one gets the board's card activity (all kinds, or
the ones ticked: created, moved, renamed, commented, assigned, ...) as a `POST`:

- **JSON**: `{ event, deliveryId, text, activity: { id, kind, data, createdAt }, card: { id, title, url },
  board: { id, name, url }, actor: { id, name } }`. Signed: `X-Kanban-Timestamp` (Unix seconds) and
  `X-Kanban-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with the webhook's secret>`. The secret
  is shown once, when the webhook is added. Also sent: `X-Kanban-Event`, `X-Kanban-Delivery`. The test button sends
  `event: "ping"`.
- **Slack** (incoming webhook URL): `{ text }`. **Discord** (webhook URL): `{ content }`, mentions disabled.

Links point at `NUXT_PUBLIC_SITE_URL` (left out when it is not set). A delivery succeeds on any `2xx` within 5
seconds; redirects are not followed. Failures are retried after 1, 5 and 30 minutes and 2 hours (5 attempts), and a
webhook turns itself off after 20 failed attempts in a row. Webhooks only reach public addresses: private, loopback,
link-local and similar ranges are refused, checked on every connection (set `NUXT_WEBHOOK_ALLOW_PRIVATE=true` in
development to allow them). Archived boards send nothing.

Verifying a JSON delivery in Node:

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(secret, headers, rawBody) {
  const ts = headers['x-kanban-timestamp']
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const expected = `sha256=${createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')}`
  const got = String(headers['x-kanban-signature'] ?? '')
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}
```
