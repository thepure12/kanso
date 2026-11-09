# Deploying Kanso

Three ways to run Kanso outside development:

- [Docker Compose (local)](#docker-compose-local): everything in containers on one machine, for trying it out.
- [Docker Compose (server)](#docker-compose-server): Postgres and the app, optionally with Caddy for automatic HTTPS.
- [systemd (no Docker)](#systemd-no-docker): the self-contained build behind your own reverse proxy.

Also: [serving under a sub-path](#sub-path), [OAuth callback URLs](#oauth) and [backups](#backups).

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
