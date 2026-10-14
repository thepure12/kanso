# Roadmap

Candidate features, roughly in priority order. None of these are started.

## Board insights
Cycle time, throughput, cumulative flow and a burndown by `estimate`, computed from `card_activity` (`created`, `moved`,
`archived`). Read only: a slideover or page per board with charts. Needs a query that rebuilds each card's column
history; the board's last column counts as "done", as for blocked cards.

## Saved filters and views
Save the current filter, view (board/list/calendar/timeline) and swimlane grouping under a name. Personal (own rows) or
shared on the board (editors manage, viewers read). New table with RLS and a notify trigger for shared ones.

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
