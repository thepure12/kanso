# kanso CLI

`kanso` (workspace package `cli/`, built into one file `cli/dist/kanso.mjs`) talks to a Kanso site with an API
token. Node 22, no runtime dependencies.

```bash
pnpm --filter kanso-cli build
node cli/dist/kanso.mjs --help
```

## Login

```bash
kanso login --url https://kanso.example.org --token kb_...   # or leave --token out and paste it
kanso whoami
kanso logout
```

The token is checked with `GET /api/me` and stored in `~/.config/kanso/config.json` (mode 600) under a profile
(`--profile`, else `KANSO_PROFILE`, else `default`). `KANSO_URL` and `KANSO_TOKEN` override the stored values.
Every command takes `--json`.

## kanso agent run

A long-running process that runs a command for board events, meant to run as a systemd user unit. It opens the
event stream (`GET /api/events`, see [API.md](API.md#event-stream)) with the token and starts a run for:

- **card activity** (`--board <ids>` with `--activity <kinds>` and/or `--columns <ids or titles>`): for example
  cards created in or moved to "To do". `--columns` alone means `--activity created,moved`. For a move, the column
  is the one the card landed in.
- **notifications** (`--notifications`): unread notifications of the token's user, e.g. a bot that is mentioned in
  a comment or assigned to a card. Each one is marked read after its run (also when the run failed), so it runs
  once. With `--board`, only notifications of those boards.

The command is either your own (`--cmd "<shell command>"`, run with `sh -c`) or the `--claude` preset. Each run
gets:

| Variable | Value |
| --- | --- |
| `KANSO_URL`, `KANSO_TOKEN` | The site and token of the runner (so the command can call the API or `kanso`) |
| `KANSO_BOARD_ID`, `KANSO_CARD_ID` | The card |
| `KANSO_CARD_URL` | Link to the card |
| `KANSO_EVENT` | The activity kind (`created`, `moved`, `commented`, `mentioned`, `assigned`, ...) |
| `KANSO_EVENT_SOURCE` | `activity` or `notification` |
| `KANSO_ACTIVITY_ID` | The activity entry |
| `KANSO_NOTIFICATION_ID` | The notification (notifications only) |

and the card as JSON on stdin: `{event, board, column, card, detail}` (`card` as in `GET /api/boards/:id`,
`detail` as `GET /api/cards/:id`: checklists, comments, links, activity; `event.notification` holds the
notification). A card that is gone by the time the run starts (archived, deleted, snoozed) is skipped. The
command's output goes to the runner's stdout/stderr (the journal under systemd).

Options:

| Option | What |
| --- | --- |
| `--concurrency <n>` | Runs at once (1-32, default 1). Never two runs on the same card: later events of a busy card wait |
| `--comment never\|failure\|always` | Comment the exit status on the card (default never) |
| `--timeout <minutes>` | Stop a run after this long (SIGTERM to its process group, SIGKILL 10 s later) |
| `--claude` | Run `claude -p` (see below) instead of `--cmd` |
| `--prompt <text>` | With `--claude`: the instructions part of the prompt |
| `--json` | Log lines as JSON on stdout instead of text on stderr |

The runner's own requests (status comments, marking notifications read) carry `x-client-id: kanso-agent`, and the
stream leaves those out, so they never start a run. Changes your command makes through MCP or the API do count:
a command that moves its card into a column the runner follows starts another run.

Reconnects: after a dropped or silent stream (no ping for 70 s) it reconnects after 1 s, doubling up to 60 s, and
reads the unread notifications again. Card activity during a disconnect is not replayed. It stops with exit code 1
when the token is refused (401), not allowed (403), a board is not found or not visible (404, `gone`) or the
parameters are wrong (400); systemd's `Restart=` then decides. On SIGINT/SIGTERM it stops listening, sends SIGTERM
to the runs in progress and waits for them (a second signal exits at once).

### --claude

`--claude` runs, per event:

```bash
claude -p "<prompt>" --mcp-config <file> --allowedTools mcp__kanso   # card JSON on stdin
```

The MCP config points at `<site>/api/mcp` with the runner's token (written to a temporary file only you can read,
removed when the runner stops). The prompt names the event, board, card, column and link, says that the kanso MCP
tools read and change the board, and ends with the instructions: `--prompt`, else "do what the card asks, then
comment with a summary; ask in a comment when unclear". `KANSO_CLAUDE_BIN` sets the binary (default `claude`). Use
`--cmd` for anything else (other flags, a git worktree per card, ...): the git and worktree flow belongs in your own
script.

### Examples

```bash
# Claude works on every card that lands in "To do"; failures are commented on the card.
kanso agent run --board $BOARD --columns "To do" --claude --comment failure

# A bot answers when it is mentioned or assigned, two cards at a time.
KANSO_TOKEN=kb_bot... kanso agent run --notifications --concurrency 2 --cmd ./handle-card.sh
```

`handle-card.sh` reads the card from stdin:

```bash
#!/bin/sh
card=$(cat)
title=$(printf '%s' "$card" | jq -r .card.title)
echo "working on $title ($KANSO_EVENT)"
```

### systemd user unit

Give the runner its own token (a bot's token is best: board → Bots), stored in an environment file only you can
read, and keep `KANSO_URL`/`KANSO_TOKEN` out of your shell profile.

`~/.config/kanso/agent.env` (mode 600):

```bash
KANSO_URL=https://kanso.example.org
KANSO_TOKEN=kb_...
```

`~/.config/systemd/user/kanso-agent.service`:

```ini
[Unit]
Description=kanso agent run (Kanso board events)
After=network-online.target

[Service]
EnvironmentFile=%h/.config/kanso/agent.env
WorkingDirectory=%h/work
ExecStart=/usr/bin/node %h/.local/lib/kanso/kanso.mjs agent run \
  --board 00000000-0000-0000-0000-000000000000 --columns "To do" \
  --claude --comment failure --timeout 60
Restart=on-failure
RestartSec=30
# Runs get SIGTERM from the runner first; give them time to finish.
KillMode=mixed
TimeoutStopSec=120

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now kanso-agent
journalctl --user -u kanso-agent -f
loginctl enable-linger "$USER"   # keep it running while you are logged out
```

`claude` must be on the unit's `PATH` (add `Environment=PATH=...` when it lives in `~/.local/bin`) and logged in
for the same user.
