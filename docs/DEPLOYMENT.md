# Deploying Kanso

Four ways to run Kanso outside development, plus a script that sets one up for you:

- [Install script](#install-script): asks a few questions, then installs Kanso as a systemd user service of a
  dedicated user, without root.
- [Docker Compose (local)](#docker-compose-local): everything in containers on one machine, for trying it out.
- [Docker Compose (server)](#docker-compose-server): Postgres and the app, optionally with Caddy for automatic HTTPS.
- [systemd (no Docker)](#systemd-no-docker): the self-contained build behind your own reverse proxy.
- [systemd without a Postgres install](#systemd-without-a-postgres-install): as above, with Postgres from an npm
  package, for servers that have neither Docker nor Postgres.

Also: [serving under a sub-path](#sub-path), [OAuth callback URLs](#oauth) and [backups](#backups).

## Install script

`deploy/install.sh` installs Kanso on a Linux server with systemd and updates it later. It runs as an ordinary user,
never as root: the app and its database run as systemd **user** services of that user, and everything lives in its
home directory. It can set up:

- `systemd-embedded`: Postgres 17 from [`deploy/embedded-pg/`](#systemd-without-a-postgres-install). Needs nothing
  but Node 22 (the script offers to download it from nodejs.org into `~/node`). The easiest choice without Docker.
- `systemd-pg`: an existing Postgres 17 server. Setting up the database needs a superuser once: give the script a
  superuser URL, or let it print the two commands for an admin to run.
- `docker`: writes `.env` and runs `docker-compose.prod.yml`, for a user that can use Docker.

### Once, as an admin

Create a system user for Kanso that nobody can log in as, and let its services run without a login session (they
then also start at boot):

```bash
sudo useradd -r -m -d /var/lib/kanso -s /usr/sbin/nologin kanso
sudo loginctl enable-linger kanso
sudo -u kanso git -C /var/lib/kanso clone <repository URL> kanban
```

`sudo -u kanso` runs a command with the rights of `kanso`, not of root. A private repository needs credentials for
`kanso`, such as a read-only deploy key.

### Install and update

```bash
sudo -u kanso /var/lib/kanso/kanban/deploy/install.sh
```

It asks for the public URL (a path such as `https://apps.example.org/kanso` sets up a [sub-path](#sub-path)), the admin
email, the SMTP URL, the setup and the ports. Then it generates all passwords, writes the configuration, builds the app,
runs the migrations, starts the services and checks that the app answers. `--dry-run` asks the same questions but only
prints the commands and files.

To update, pull and run the script again: it finds its settings, then builds, migrates and restarts.

```bash
sudo -u kanso git -C /var/lib/kanso/kanban pull
sudo -u kanso /var/lib/kanso/kanban/deploy/install.sh
```

### What it writes

All in the home of `kanso` (`~` below is `/var/lib/kanso`):

| Path | Contents |
| --- | --- |
| `~/.local/share/kanso/app/` | `.output` (the running build; the previous one in `.output.old`) and `.env` (settings, secrets) |
| `~/.local/share/kanso/pg/`, `pg-data/` | embedded Postgres: `start.mjs`, `node_modules`, `.env` (passwords); the data directory |
| `~/.config/systemd/user/` | `kanso.service`, `kanso-pg.service` |
| `~/.config/kanso/install.conf` | settings for updates, including the migration (owner) database URL |
| `~/.local/share/kanso/apache-kanso.conf` | Apache snippet for the reverse proxy |

To change a setting (mail, OAuth keys), edit `~/.local/share/kanso/app/.env` and restart. Managing the services
as an admin:

```bash
sudo -u kanso XDG_RUNTIME_DIR=/run/user/$(id -u kanso) systemctl --user restart kanso
sudo journalctl _UID=$(id -u kanso) -f      # logs of both services
```

### Reverse proxy

The app listens on `127.0.0.1` only. The script writes an Apache snippet for the URL you gave and prints the steps
for an admin: copy it to `/etc/apache2/kanso.conf`, `a2enmod proxy proxy_http headers`, add
`Include /etc/apache2/kanso.conf` inside the existing `<VirtualHost *:443>` of the host, reload Apache. For another
proxy, see [Your own reverse proxy](#your-own-reverse-proxy).

### Backups

For the embedded Postgres, stop both services and copy `~/.local/share/kanso/pg-data` (see
[Backups (embedded)](#backups-embedded)); with `systemd-pg`, use `pg_dump`. Also keep the `.env` files: without
`NUXT_SESSION_PASSWORD` (or `NUXT_TOTP_KEY`) two-factor secrets cannot be read.

## Docker Compose (local)

The `Dockerfile` builds the app and runs `.output/server/index.mjs` as a non-root user. To run everything in containers:

```bash
cp .env.example .env          # set NUXT_SESSION_PASSWORD, NUXT_PUBLIC_SITE_URL, mail settings
docker compose --profile app up -d --build
```

This starts Postgres, sets up the database schema (`migrate` service: creates the tables, policies and functions on the
first start, applies new migrations after an update) and then the app on port 3000.

- Inside compose the database URLs point at host `db` (set in `docker-compose.yml`, overriding `.env`), using the
  development passwords from `docker/init.sql`. Change both for a real deployment.
- To migrate again after an update: `docker compose --profile app run --rm migrate`.
- The container runs with `NODE_ENV=production`, so session cookies are `Secure`: serve it over HTTPS (or on `localhost`).

## Docker Compose (server)

`docker-compose.prod.yml` takes the role passwords from `.env` and keeps Postgres off the host's ports. Before the app
starts, the `migrate` service sets up the database schema: on the first start it creates all tables, row-level security
policies and functions (an empty database has only the roles); after an update it applies any new migrations; otherwise
it does nothing and exits. Caddy, for HTTPS with automatic certificates on ports 80 and 443, is optional (compose
profile `caddy`).

Add to `.env`:

```bash
COMPOSE_PROFILES=caddy              # leave out to use your own reverse proxy
KANBAN_DOMAIN=kanban.example.com    # DNS points here; with Caddy, ports 80 and 443 open
POSTGRES_PASSWORD=...               # openssl rand -hex 32 for each password
KANBAN_OWNER_PASSWORD=...           # hex only: they go into connection URLs
KANBAN_APP_PASSWORD=...
KANBAN_AUTH_PASSWORD=...
```

plus `NUXT_SESSION_PASSWORD`, `NUXT_ADMIN_EMAIL` and the mail settings, then:

```bash
docker compose -f docker-compose.prod.yml up -d --build   # also after each update; migrations run first
```

### Your own reverse proxy

Without Caddy, put your own reverse proxy (Apache, nginx, Traefik, ...) in front of the app:

- The app is published on `KANBAN_APP_PORT`, default `127.0.0.1:3000` (reachable from the host only). Point your proxy
  there, or set e.g. `KANBAN_APP_PORT=3000` to listen on all interfaces.
- The proxy must terminate HTTPS: session cookies are `Secure`.
- The proxy must **replace** the client's `X-Forwarded-For` header with the real client address, not append to it.
  The app takes the first address in that header as the client's, and the login and sign-up rate limits are keyed on
  it. A proxy that keeps a client-sent value lets anyone get around them with a new fake address per request.
- Live updates (`/api/boards/:id/events`, `/api/notifications/events`) are Server-Sent Events: the proxy must pass them
  on unbuffered and uncompressed. The app sends a ping every 25 s, so the default idle timeouts (60 s) are enough.
- The proxy must accept request bodies up to about 12 MB (attachments are limited to 10 MB).

To check: sign in and open Account → Sessions. The session must show your real IP address, not the proxy's (such as
`127.0.0.1`).

**Apache** (`a2enmod proxy proxy_http headers ssl`; certificate e.g. from `certbot --apache`):

```apache
<VirtualHost *:443>
    ServerName kanban.example.com

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/kanban.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/kanban.example.com/privkey.pem

    ProxyPreserveHost On

    # mod_proxy appends the client address to X-Forwarded-For; drop any value the
    # client sent first, so the header holds only the real address.
    RequestHeader unset X-Forwarded-For
    RequestHeader set X-Forwarded-Proto "https"

    # Server-Sent Events: no compression, pass each message on at once
    SetEnvIf Request_URI "/events$" no-gzip=1
    ProxyPass        / http://127.0.0.1:3000/ flushpackets=on
    ProxyPassReverse / http://127.0.0.1:3000/
</VirtualHost>
```

**nginx** (inside the `server` block with your TLS settings):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # not $proxy_add_x_forwarded_for, which appends
    proxy_set_header X-Forwarded-Proto https;
    proxy_buffering off;                             # Server-Sent Events
    client_max_body_size 12m;                        # attachments; the default is 1m
}
```

If the proxy runs in a container rather than on the host, `127.0.0.1` is the container itself: publish the app on an
address the container can reach instead, or put both on one Docker network.

### Notes

- `NUXT_PUBLIC_SITE_URL` is set to `https://$KANBAN_DOMAIN`.
- The role passwords are applied only when the `pgdata` volume is created. To change them later, use
  `ALTER ROLE ... PASSWORD` and update `.env`.
- OAuth callback URLs become `https://<domain>/auth/<provider>`.

## systemd (no Docker)

The build output (`.output/`) is self-contained: no `node_modules`, no native modules, and the app writes nothing to
disk (data and uploads live in Postgres). The server needs only a Node 22 binary (the official tarball is enough) and
access to a Postgres 17 database. You can build and migrate from another machine.

The commands below use shell variables; set them to suit the server:

```bash
APP_DIR=...          # where .output and .env live on the server (may be root-owned and read-only)
NODE_BIN=...         # the node binary, e.g. "$(command -v node)"
SERVICE=kanso        # systemd unit name, also used as the service user
PORT=3000            # local port the reverse proxy forwards to
SERVER=...           # SSH host of the server
```

### 1. Database (once)

As a Postgres superuser, create the database and run `docker/init.sql` with real role passwords (hex only: they go
into connection URLs). Without the variables it falls back to the development passwords.

```bash
createdb kanban
psql -v ON_ERROR_STOP=1 -d kanban \
  -v owner_pw="$(openssl rand -hex 32)" -v app_pw="$(openssl rand -hex 32)" -v auth_pw="$(openssl rand -hex 32)" \
  -f docker/init.sql          # note the three passwords for .env
```

### 2. Configuration (once)

On the server, write `$APP_DIR/.env` from `.env.example`: the three database URLs with the new passwords,
`NUXT_SESSION_PASSWORD`, `NUXT_ADMIN_EMAIL`, `NUXT_PUBLIC_SITE_URL` and the mail settings (plus `NUXT_APP_BASE_URL`
for a [sub-path](#sub-path)). Keep it readable by the service user only:

```bash
sudo useradd -r -s /usr/sbin/nologin "$SERVICE"
sudo mkdir -p "$APP_DIR"
# write "$APP_DIR/.env" now, then:
sudo chown root:"$SERVICE" "$APP_DIR/.env" && sudo chmod 640 "$APP_DIR/.env"
```

### 3. Service (once)

```bash
sudo tee "/etc/systemd/system/$SERVICE.service" >/dev/null <<EOF
[Unit]
Description=Kanso
After=network.target postgresql.service

[Service]
User=$SERVICE
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=$PORT
ExecStart=$NODE_BIN .output/server/index.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable "$SERVICE"
```

### 4. Each release

Build on any machine with the repository (set `NUXT_APP_BASE_URL` here, it is fixed at build time), migrate before
starting the new code, then swap `.output` and restart:

```bash
# build machine
pnpm build && tar -czf kanso.tgz .output
ssh -fN -L 5433:localhost:5432 "$SERVER"      # tunnel to the server's Postgres, if it only listens locally
MIGRATION_DATABASE_URL=postgres://kanban_owner:<owner password>@localhost:5433/kanban pnpm db:migrate
scp kanso.tgz "$SERVER":

# server
sudo rm -rf "$APP_DIR/.output" && sudo tar -xzf ~/kanso.tgz -C "$APP_DIR" && rm ~/kanso.tgz
sudo systemctl restart "$SERVICE"
journalctl -u "$SERVICE" -f
```

### 5. Reverse proxy

Put HTTPS in front of `127.0.0.1:$PORT` (the cookies are `Secure`). The requirements and the Apache and nginx examples
are in [Your own reverse proxy](#your-own-reverse-proxy); use `$PORT` instead of `3000`.

The Nitro scheduled tasks (email digest, recurring cards, webhook retries) run inside the service; no cron is needed.

## systemd without a Postgres install

When the server has neither Docker nor a system Postgres (and no hosted one), `deploy/embedded-pg/` runs Postgres 17
from the [`embedded-postgres`](https://github.com/leinelissen/embedded-postgres) npm package: npm downloads the
Postgres binaries into `node_modules`, so nothing is installed system-wide and no root is needed to run it. A small
Node script (`start.mjs`) starts it as a second systemd service next to the app.

`start.mjs` listens on `127.0.0.1` only (no Unix socket) and, on every start, creates the database `kanban`, the three
roles and the schema settings from `docker/init.sql` when they are missing, and sets the role passwords from its
environment. Changing a role password is therefore: edit both `.env` files, restart both services.

Limits:

- `embedded-postgres` publishes Postgres 17 only as beta versions; `package.json` pins one exactly.
- The package ships `postgres`, `initdb` and `pg_ctl`, not `pg_dump` or `psql`. See [backups](#backups-embedded) below.
- Postgres refuses to run as root: the service needs its own user.
- Upgrading to a new Postgres major version needs a dump and restore, which needs `pg_dump` from somewhere.

Follow [systemd (no Docker)](#systemd-no-docker) with these changes; the extra variables:

```bash
PG_DIR=/opt/kanso-pg     # start.mjs, package.json and node_modules (root-owned, read-only)
PG_SERVICE=kanso-pg      # systemd unit name and service user; data goes to /var/lib/$PG_SERVICE
PG_PORT=5432             # port on 127.0.0.1
NPM_BIN=...              # the npm binary next to $NODE_BIN
```

### 1. Database (once, replaces step 1)

Copy `deploy/embedded-pg/` to the server and install it there (the binaries are platform specific: install on the
server, not on the build machine):

```bash
scp -r deploy/embedded-pg "$SERVER":kanso-pg
# server
sudo mv ~/kanso-pg "$PG_DIR" && sudo chown -R root:root "$PG_DIR"
cd "$PG_DIR" && sudo "$NPM_BIN" ci --omit=dev
sudo useradd -r -s /usr/sbin/nologin "$PG_SERVICE"
```

Write `$PG_DIR/.env` with four new passwords (letters and digits only, at least 16; the same role passwords go into
the app's database URLs in step 2):

```bash
sudo tee "$PG_DIR/.env" >/dev/null <<EOF
PG_PORT=$PG_PORT
POSTGRES_PASSWORD=$(openssl rand -hex 32)
KANBAN_OWNER_PASSWORD=$(openssl rand -hex 32)
KANBAN_APP_PASSWORD=$(openssl rand -hex 32)
KANBAN_AUTH_PASSWORD=$(openssl rand -hex 32)
EOF
sudo chown root:"$PG_SERVICE" "$PG_DIR/.env" && sudo chmod 640 "$PG_DIR/.env"
```

`POSTGRES_PASSWORD` (the superuser) is fixed when the data directory is created on the first start; the role passwords
are applied on every start.

The Postgres service. `KillMode=mixed` sends the stop signal to the Node script only, which shuts Postgres down with a
fast shutdown (Postgres's own reaction to SIGTERM would wait for the app's connections to close):

```bash
sudo tee "/etc/systemd/system/$PG_SERVICE.service" >/dev/null <<EOF
[Unit]
Description=Kanso Postgres (embedded)
After=network.target

[Service]
User=$PG_SERVICE
WorkingDirectory=$PG_DIR
EnvironmentFile=$PG_DIR/.env
Environment=PGDATA_DIR=/var/lib/$PG_SERVICE/data
StateDirectory=$PG_SERVICE
StateDirectoryMode=0700
ExecStart=$NODE_BIN start.mjs
KillMode=mixed
TimeoutStopSec=60
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now "$PG_SERVICE"
journalctl -u "$PG_SERVICE"     # ends with "READY: Postgres on 127.0.0.1:..."
```

### 2. and 3. Configuration and app service

As in [systemd (no Docker)](#systemd-no-docker), with the database URLs pointing at
`postgres://kanban_app:<app password>@127.0.0.1:$PG_PORT/kanban` (and `kanban_auth`, `kanban_owner` likewise). In the
app's unit, replace `After=network.target postgresql.service` with:

```ini
Requires=kanso-pg.service
After=network.target kanso-pg.service
```

(use your `$PG_SERVICE` name). Then migrate once as in step 4 (through the SSH tunnel to `$PG_PORT`) before the first
start of the app. Each release afterwards is the same as step 4.

### Backups (embedded)

Without `pg_dump`, back up the data directory while Postgres is stopped:

```bash
sudo systemctl stop "$SERVICE" "$PG_SERVICE"
sudo tar -czf "kanso-pg-$(date +%F).tgz" -C "/var/lib/$PG_SERVICE" data
sudo systemctl start "$PG_SERVICE" "$SERVICE"
```

A copy taken while Postgres runs is not safe. A filesystem snapshot (LVM, ZFS, btrfs) of the whole data directory
works without stopping, since Postgres recovers from it as from a crash. Restore by stopping the service and putting
the `data` directory back (owned by `$PG_SERVICE`, mode 0700). If `pg_dump` 17 is available on another machine,
`pg_dump -Fc` through the SSH tunnel also works, as the `postgres` superuser.

## Sub-path

To serve the app under a path such as `https://example.org/kanso/`, set in `.env` before building:

```bash
NUXT_APP_BASE_URL=/kanso/
NUXT_PUBLIC_SITE_URL=https://example.org/kanso
```

- The base path is fixed at build time (`pnpm build`; for Docker the `NUXT_APP_BASE_URL` build arg, which
  `docker-compose.prod.yml` takes from `.env`), so rebuild after changing it.
- The reverse proxy forwards the path unchanged (`/kanso/...` to `http://127.0.0.1:3000/kanso/...`).
- Under a sub-path the session cookie is named `kanso-session` and scoped to the path, so other apps on the same host
  do not see it.
- OAuth callback URLs become `https://example.org/kanso/auth/<provider>`.

## OAuth

Set the client ID and secret in `.env`. The login page shows only providers that have credentials set.
Callback URLs in development:

| Provider | Callback URL |
| --- | --- |
| Discord | `http://localhost:3000/auth/discord` |
| GitHub | `http://localhost:3000/auth/github` |
| Google | `http://localhost:3000/auth/google` |

In production, replace `http://localhost:3000` with `NUXT_PUBLIC_SITE_URL`. An OAuth login links to an existing
account with the same email only when the provider reports the email as verified.

## Backups

Back up the database (`pg_dump -Fc kanban`): it holds attachments and uploaded images too.
