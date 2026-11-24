# kanso CLI

`kanso` (workspace package `cli/`, built into one file `cli/dist/kanso.mjs`) talks to a Kanso site with an API
token. Node 22, no runtime dependencies.

## Install

Every Kanso site serves the CLI it was built with, so the version always matches the server:

```bash
curl -fsSL https://kanso.example.org/cli/install.sh | sh     # under a base path: https://host/kanso/cli/install.sh
kanso login --url https://kanso.example.org                    # paste an API token when asked
```

The script needs Node.js 22 or newer and curl or wget. It downloads `<site>/cli/kanso.mjs` into `~/.local/bin/kanso`
(`KANSO_BIN_DIR=<dir>` to put it elsewhere) and prints the version; run it again to update. Without the script:
`curl -fsSL <site>/cli/kanso.mjs -o ~/.local/bin/kanso && chmod +x ~/.local/bin/kanso`. The account page (API
tokens, bots) and the bots panel of a board show these commands with the site filled in. Nothing is published to npm.

The site in the script is `NUXT_PUBLIC_SITE_URL`, else the address the script was fetched from. `pnpm build` (and
so the Docker image and `deploy/install.sh`) builds the CLI before the app and bundles `cli/dist` into the server;
in development run `pnpm --filter kanso-cli build` once, else `/cli/kanso.mjs` answers 404.

From a checkout:

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

A long-running process that runs a command for board events, meant to run as a systemd user unit
([`kanso agent install`](#running-it-as-a-service)). It opens the event stream (`GET /api/events`, see
[API.md](API.md#event-stream)) with the token and starts a run for:

- **card activity** (`--board <ids or names>` with `--activity <kinds>` and/or `--columns <ids or titles>`): for example
  cards created in or moved to "To do". `--columns` alone means `--activity created,moved`. For a move, the column
  is the one the card landed in.
- **agent rules** (only `--board <ids or names>`, with a bot's token): the rules set on the board for that bot, see
  [Agent rules](#agent-rules).
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
| `KANSO_RULE_ID`, `KANSO_RULE_NAME` | The agent rule (agent rules only) |

and the card as JSON on stdin: `{event, board, column, card, detail, rule?}` (`card` as in `GET /api/boards/:id`,
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

### Agent rules

Editors set agent rules on the board (board menu "Agent rules"): a name, the bot, the event (card created, card
moved, card tag added, the bot assigned, the bot mentioned in a comment), optionally a column (the card is moved
into / is in it) and a card tag (the card carries it; for "card tag added": the added tag), Markdown instructions,
and what happens after the run: move the card to a column (only after a successful run) and comment the exit
status (never, only failures, always).

```bash
KANSO_TOKEN=kb_bot... kanso agent run --board $BOARD --claude
```

With only `--board` the runner needs a bot's token (else exit 2) and follows that bot's active rules on those
boards: it subscribes to every kind a rule can need, reads the rules at each (re)connect and again whenever the
board changes (so rules added, edited or paused in the UI apply without a restart), and starts one run per
matching rule. Before a run it checks the loaded card again: still in the rule's column, the tag, the bot really
the one assigned or mentioned, and never an event the bot caused itself (so its own moves and comments do not loop).
With `--claude` the rule's instructions replace `--prompt`; with `--cmd` they are `rule.instructions` on stdin. The
runner's move goes to the end of the column (column rules run) and, like its comments, starts no run. `--comment`
is refused in this mode (the rules set it). Rules are not copied with the board or exported.

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

### Running it as a service

`kanso agent install` sets the runner up as a systemd user service, so it starts by itself (at login, or at
boot with linger) and restarts after failures. It takes the same options as `agent run`:

```bash
kanso login --profile triage --url https://kanso.example.org --token kb_bot...   # a bot's token is best (board → Bots)
cd ~/work                                                     # the runs' working directory (or --workdir)
kanso agent install --profile triage --name triage --board Kanso --claude
loginctl enable-linger "$USER"                                # keep it running while you are logged out
```

It checks the options and the token like `agent run` (boards, columns, agent rules need a bot), then:

- writes `~/.config/kanso/agent-<name>.env` (mode 600) with `KANSO_URL` and `KANSO_TOKEN` of the chosen profile
  (or `KANSO_URL`/`KANSO_TOKEN`), so the token never appears in the unit or on a command line;
- writes `~/.config/systemd/user/kanso-agent-<name>.service` (`$XDG_CONFIG_HOME` is honoured) with the absolute
  paths of `node` and the `kanso` script, boards and columns as ids (names in a comment), a `PATH` with node's and
  `claude`'s directories first, `Restart=on-failure`, `KillMode=mixed` (runs get SIGTERM from the runner first);
- runs `systemctl --user daemon-reload`, `enable` and `restart`, and says when linger is off.

`--name` tells several agents apart (without it: `kanso-agent.service`, `agent.env`). Run `install` again with new
options to change an agent (it restarts it). `--dry-run` prints both files (token masked) and the commands and changes
nothing; without a systemd user manager (macOS, most containers) it prints the same and writes nothing. With `--claude`,
`claude` must be on `PATH` (or `KANSO_CLAUDE_BIN`) and logged in for the same user. The unit pins the current `node`
binary: after moving to another Node version (nvm), run `install` again.

```bash
journalctl --user -u kanso-agent-triage -f      # its output
systemctl --user status kanso-agent-triage
kanso agent uninstall --name triage             # stops, disables, removes both files
```

`uninstall` does not revoke the token; revoke it in Kanso when nothing else uses it.
