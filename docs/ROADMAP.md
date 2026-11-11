# Roadmap

Candidate features, roughly in priority order. None of these are started.

## Board insights
Cycle time, throughput, cumulative flow and a burndown by `estimate`, computed from `card_activity` (`created`, `moved`,
`archived`). Read only: a slideover or page per board with charts. Needs a query that rebuilds each card's column
history; the board's last column counts as "done", as for blocked cards.

## Agent integration
Builds on the MCP endpoint (`POST /api/mcp`, see `docs/API.md`). Candidates:
- **OAuth for MCP clients**: let agents sign in through the MCP authorization flow (protected resource metadata,
  dynamic client registration) instead of a pasted API token; tokens issued per client, revocable on `/account`.
- **More MCP tools**: card links, tags and columns, time entries, watch/unwatch; MCP resources (boards as readable
  resources) and prompts (e.g. "triage this board", "write a standup from my work").
- **Built-in assistant**: an AI panel in the app using the Claude API with a server-side key (opt-in per instance):
  summarise a board or a card's history, turn pasted notes into cards, suggest tags and assignees. Runs as the user
  through the same routes as the MCP tools.
- **Agents as board members**: bot accounts that can be assigned cards and added to boards like people (own role,
  no login, API token only). Assigning a card to one triggers a webhook to the agent, which works through the MCP
  tools and reports back in comments.

## Saved filters and views
Save the current filter, view (board/list/calendar/timeline) and swimlane grouping under a name. Personal (own rows) or
shared on the board (editors manage, viewers read). New table with RLS and a notify trigger for shared ones.

## Column groups in every view
The column group picker only narrows the board view (and its swimlanes) today. Apply it to the list, calendar and
timeline views too, showing only cards in the group's columns, and keep it with saved views.

## Calendar (iCal) feed
A per-user secret URL serving start and due dates of the cards from My work as `text/calendar`, for Google Calendar,
Outlook and similar. Token handled like API tokens (hashed, revocable, read only).

## Subtasks
`cards.parent_id` with a same-board composite FK, progress roll-up on the parent card and a child list in the card
dialog. Touches copy, export/import, filters and templates.

## Comment reactions and reply by email
Emoji reactions on comments (small: one table, viewers react). Reply by email to post a comment needs an inbound mail
route (MTA or provider webhook) and signed reply addresses.

## Public read-only share link
An owner-created secret link that shows a board read only without signing in. Served through a `SECURITY DEFINER`
read function keyed by the link token; revocable; no member data or attachments beyond what the board shows.

## Operations
- `GET /api/health` (database ping) for the Docker/compose healthcheck and load balancers.
- Optional S3-compatible storage for attachments instead of `bytea` in Postgres.
