#!/usr/bin/env bash
# Kanso install and update script. See docs/DEPLOYMENT.md, "Install script".
#
# Runs as the user Kanso runs as, never as root. Create that user once, as an
# admin (a system user nobody can log in as):
#
#   sudo useradd -r -m -d /var/lib/kanso -s /usr/sbin/nologin kanso
#   sudo loginctl enable-linger kanso      # its services run without a login, start at boot
#   sudo -u kanso git -C /var/lib/kanso clone <repository> kanban
#   sudo -u kanso /var/lib/kanso/kanban/deploy/install.sh
#
# To update: git pull as kanso, then run the script again.
#
# Modes:
#   systemd-embedded  Postgres 17 from deploy/embedded-pg (npm), app as a systemd user service
#   systemd-pg        an existing Postgres 17, app as a systemd user service
#   docker            docker-compose.prod.yml
#
# Everything lives in the user's home: ~/.local/share/kanso (app, Postgres, data),
# ~/.config/systemd/user (units), ~/.config/kanso/install.conf (settings for updates).
#
# Options:
#   --dry-run   ask the questions, then print the commands and files instead of running/writing them
#
# Planned: --prebuilt kanso.tgz, to install a build made elsewhere so the server needs no pnpm
# (migrations would still need drizzle-kit, e.g. a bundled migrate step).
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p}' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- output helpers

if [[ -t 1 ]]; then B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' N=$'\e[0m'; else B='' G='' Y='' R='' N=''; fi
say() { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok() { printf '%s%s%s\n' "$G" "$*" "$N"; }
warn() { printf '%sWarning:%s %s\n' "$Y" "$N" "$*" >&2; }
die() { printf '%sError:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }
dry() { ((DRY_RUN)); }
# A hard requirement; in a dry run only a warning.
need() { if dry; then warn "$* (ignored in a dry run)"; else die "$*"; fi; }

# Hide generated secrets (64 hex digits) and URL passwords when echoing commands.
redact() { sed -E 's/[0-9a-f]{64}/***/g; s#(://[^:/@ ]+):[^@ ]+@#\1:***@#g'; }

# run CMD...: echo it, then run it (dry run: echo only).
run() {
  { printf '+'; printf ' %q' "$@"; printf '\n'; } | redact
  dry || "$@"
}

# write_file PATH MODE < content
write_file() {
  local path=$1 mode=$2 content
  content=$(cat)
  if dry; then
    printf '%s--- %s (mode %s)%s\n%s\n%s---%s\n' "$B" "$path" "$mode" "$N" "$content" "$B" "$N"
    return
  fi
  mkdir -p "$(dirname "$path")"
  (umask 077 && printf '%s\n' "$content" >"$path.tmp")
  chmod "$mode" "$path.tmp"
  mv "$path.tmp" "$path"
}

# ---------------------------------------------------------------- input helpers

# Answers come from the terminal, also under `sudo -u`. KANSO_INPUT (a file) is for testing.
{ exec 3<"${KANSO_INPUT:-/dev/tty}"; } 2>/dev/null || die "This script asks questions: run it in a terminal."

# ask VAR "Question" [default]
ask() {
  local __var=$1 prompt=$2 def=${3-} reply
  if [[ -n $def ]]; then printf '%s [%s]: ' "$prompt" "$def" >&2; else printf '%s: ' "$prompt" >&2; fi
  IFS= read -r reply <&3 || die "No answer (end of input)."
  [[ -n ${KANSO_INPUT:-} ]] && printf '%s\n' "$reply" >&2
  printf -v "$__var" '%s' "${reply:-$def}"
}

# ask_yn "Question" y|n
ask_yn() {
  local prompt=$1 def=${2:-y} reply hint
  [[ $def == y ]] && hint=Y/n || hint=y/N
  while :; do
    ask reply "$prompt ($hint)" ''
    case ${reply,,} in
      '') [[ $def == y ]]; return ;;
      y | yes) return 0 ;;
      n | no) return 1 ;;
    esac
  done
}

secret() {
  if command -v openssl >/dev/null; then openssl rand -hex 32
  else node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'; fi
}

# A value for a .env line, read the same way by systemd, docker compose and dotenv.
env_value() {
  local v=$1
  if [[ $v =~ ^[A-Za-z0-9_./:@+=,-]*$ ]]; then printf '%s' "$v"; return; fi
  [[ $v != *"'"* && $v != *$'\n'* ]] || die "Values cannot contain a single quote or a line break: $v"
  printf "'%s'" "$v"
}

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# ---------------------------------------------------------------- environment

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO"
[[ -f package.json && -f docker-compose.prod.yml && -d deploy/embedded-pg ]] || die "Run this from a Kanso checkout."

((EUID != 0)) || die "Do not run this as root. Create a user for Kanso and run it as that user:
  sudo useradd -r -m -d /var/lib/kanso -s /usr/sbin/nologin kanso
  sudo loginctl enable-linger kanso
  sudo -u kanso $REPO/deploy/install.sh
(see docs/DEPLOYMENT.md, \"Install script\")."
[[ $(uname -s) == Linux ]] || die "Linux only."

USER_NAME=$(id -un)
HOME=$(getent passwd "$USER_NAME" | cut -d: -f6) # sudo -u may keep the caller's HOME
export HOME
cd "$REPO"
[[ -w $REPO ]] || die "$REPO is not writable by $USER_NAME. Clone it as $USER_NAME."

KANSO_HOME=$HOME/.local/share/kanso
CONF=$HOME/.config/kanso/install.conf
UNIT_DIR=$HOME/.config/systemd/user
NODE_DIR=$HOME/node
APP_UNIT=kanso.service
PG_UNIT=kanso-pg.service

# Settings kept in install.conf for updates.
CONF_KEYS=(MODE SITE_URL BASE_URL APP_PORT PG_PORT NODE_BIN MIGRATION_URL)
MODE='' SITE_URL='' BASE_URL=/ APP_PORT=3000 PG_PORT=5432 NODE_BIN='' MIGRATION_URL=''

save_conf() {
  local k
  for k in "${CONF_KEYS[@]}"; do printf '%s=%q\n' "$k" "${!k}"; done | write_file "$CONF" 600
}

# ---------------------------------------------------------------- systemd user manager

user_systemd_ready() {
  # sudo -u resets the environment: point systemctl --user at this user's manager.
  local uid; uid=$(id -u)
  if [[ -d /run/user/$uid ]]; then
    export XDG_RUNTIME_DIR=/run/user/$uid
    export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus
  fi
  local linger
  linger=$(loginctl show-user "$USER_NAME" -p Linger --value 2>/dev/null || true)
  [[ $linger == yes ]] || need "Lingering is off for $USER_NAME, so its services would stop without a login and not start at boot. As an admin, run:
  sudo loginctl enable-linger $USER_NAME
then run this script again."
  systemctl --user show-environment >/dev/null 2>&1 \
    || need "Cannot reach the systemd user manager of $USER_NAME (XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-unset}). Enable lingering (above), then run this script with: sudo -u $USER_NAME $REPO/deploy/install.sh"
}

show_logs() {
  local unit=$1
  journalctl --user -u "$unit" -n 40 --no-pager 2>/dev/null || true
  say "Full logs: journalctl --user -u $unit (as $USER_NAME), or as an admin: sudo journalctl _UID=$(id -u) -u $unit"
}

# ---------------------------------------------------------------- Node.js and pnpm

node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null; }

find_node() {
  local cand major
  for cand in "$NODE_BIN" "$NODE_DIR/bin/node" "$(command -v node || true)"; do
    [[ -n $cand && -x $cand ]] || continue
    major=$(node_major "$cand") || continue
    if ((major >= 22)); then NODE_BIN=$(readlink -f "$cand"); return 0; fi
  done
  return 1
}

install_node() {
  local arch
  case $(uname -m) in
    x86_64) arch=x64 ;;
    aarch64) arch=arm64 ;;
    *) die "No Node.js build for $(uname -m) here; install Node 22 into $NODE_DIR yourself." ;;
  esac
  command -v curl >/dev/null || die "curl is needed to download Node.js."
  local base=https://nodejs.org/dist/latest-v22.x line file tmp
  line=$(curl -fsSL "$base/SHASUMS256.txt" | grep -E " node-v22\.[0-9.]+-linux-$arch\.tar\.xz$") \
    || die "Could not read $base/SHASUMS256.txt"
  file=${line##* }
  say "Downloading $file into $NODE_DIR"
  if dry; then NODE_BIN=$NODE_DIR/bin/node; return; fi
  tmp=$(mktemp -d)
  curl -fSL --progress-bar -o "$tmp/$file" "$base/$file"
  (cd "$tmp" && sha256sum -c --quiet - <<<"$line") || die "Checksum mismatch for $file"
  rm -rf "$NODE_DIR.new" && mkdir -p "$NODE_DIR.new"
  tar -xJf "$tmp/$file" -C "$NODE_DIR.new" --strip-components=1
  rm -rf "$NODE_DIR" "$tmp"
  mv "$NODE_DIR.new" "$NODE_DIR"
  NODE_BIN=$NODE_DIR/bin/node
}

setup_node() {
  step "Node.js"
  if ! find_node; then
    say "No Node.js 22 or newer found."
    ask_yn "Download Node.js 22 from nodejs.org into $NODE_DIR?" y || die "Install Node.js 22 or newer and run this script again."
    install_node
  fi
  # npm, npx and corepack from the same Node.
  PATH=$(dirname "$NODE_BIN"):$PATH
  export PATH
  ok "Node $("$NODE_BIN" -v 2>/dev/null || echo 22) at $NODE_BIN"
}

# pnpm in the version from package.json's packageManager field.
pnpm() {
  if command -v corepack >/dev/null; then
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm "$@"
  else
    npx --yes "$(node -p 'require("./package.json").packageManager')" "$@"
  fi
}

# ---------------------------------------------------------------- questions

ask_site() {
  step "Site"
  local url path
  while :; do
    ask url "Public URL of Kanso, e.g. https://apps.example.org/kanso" "$SITE_URL"
    url=${url%/}
    if [[ $url =~ ^https?://([A-Za-z0-9.-]+(:[0-9]+)?)((/[A-Za-z0-9._-]+)*)$ ]]; then
      SITE_URL=$url
      SITE_HOST=${BASH_REMATCH[1]}
      path=${BASH_REMATCH[3]}
      BASE_URL=${path:-}/
      [[ $url == https://* ]] || warn "Session cookies are Secure: the site must be served over HTTPS."
      break
    fi
    warn "Expected e.g. https://apps.example.org/kanso"
  done
  ask ADMIN_EMAIL "Admin email (can always sign up, becomes instance admin)" "${ADMIN_EMAIL:-}"
  [[ $ADMIN_EMAIL == *@* ]] || die "An admin email is needed: a fresh install lets only that address sign up."
  say "Mail: sign-ups confirm their address through a mailed link, e.g. smtps://user:password@smtp.example.org:465"
  ask SMTP_URL "SMTP URL (blank: no mail for now)" ''
  [[ -n $SMTP_URL ]] || warn "Without SMTP, password sign-ups cannot be confirmed. Set NUXT_MAIL_SMTP_URL later."
  ask MAIL_FROM "Sender address" "Kanso <kanso@${SITE_HOST%%:*}>"
}

ask_port() { # VAR "Question" default
  local __var=$1 port
  while :; do
    ask port "$2" "$3"
    [[ $port =~ ^[0-9]+$ ]] && ((port > 0 && port < 65536)) || { warn "Not a port number."; continue; }
    if port_in_use "$port"; then warn "Something already listens on 127.0.0.1:$port."; continue; fi
    printf -v "$__var" '%s' "$port"
    return
  done
}

choose_mode() {
  step "Setup"
  local docker=0 have_pg=0 choice def
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then docker=1; fi
  if command -v psql >/dev/null; then have_pg=1; fi
  say "  1) systemd-embedded  Postgres 17 from an npm package, nothing else to install (recommended without Docker)"
  say "  2) systemd-pg        use an existing Postgres 17 server$( ((have_pg)) || echo ' (needs psql)')"
  say "  3) docker            docker-compose.prod.yml$( ((docker)) || echo ' (Docker not usable by this user)')"
  def=1
  while :; do
    ask choice "Choose" "$def"
    case $choice in
      1) MODE=systemd-embedded; return ;;
      2) ((have_pg)) || { warn "psql not found. Ask an admin to install postgresql-client."; continue; }; MODE=systemd-pg; return ;;
      3) ((docker)) || { warn "docker compose is not available to $USER_NAME."; continue; }; MODE=docker; return ;;
    esac
  done
}

# ---------------------------------------------------------------- database: embedded

PG_HOME=$KANSO_HOME/pg

install_embedded_files() {
  # Returns 0 when the files changed (Postgres needs a restart).
  local changed=1
  if cmp -s deploy/embedded-pg/package-lock.json "$PG_HOME/package-lock.json" \
    && cmp -s deploy/embedded-pg/start.mjs "$PG_HOME/start.mjs" && [[ -d $PG_HOME/node_modules ]]; then
    changed=0
  fi
  ((changed)) || return 1
  run mkdir -p "$PG_HOME"
  run cp deploy/embedded-pg/package.json deploy/embedded-pg/package-lock.json deploy/embedded-pg/start.mjs "$PG_HOME/"
  run npm --prefix "$PG_HOME" ci --omit=dev --no-audit --no-fund
}

write_pg_unit() {
  write_file "$UNIT_DIR/$PG_UNIT" 644 <<EOF
# Written by deploy/install.sh
[Unit]
Description=Kanso Postgres (embedded)

[Service]
WorkingDirectory=$PG_HOME
EnvironmentFile=$PG_HOME/.env
Environment=PGDATA_DIR=$KANSO_HOME/pg-data
ExecStart=$NODE_BIN start.mjs
# Stop signal to the Node script only; it shuts Postgres down with a fast shutdown.
KillMode=mixed
TimeoutStopSec=60
Restart=on-failure
NoNewPrivileges=true

[Install]
WantedBy=default.target
EOF
}

# Wait until kanban_owner can connect, which start.mjs allows only once setup is done.
wait_pg() {
  dry && return
  say "Waiting for Postgres (the first start downloads nothing but sets up a new cluster)..."
  local i
  for ((i = 0; i < 120; i++)); do
    if (cd "$PG_HOME" && U=$MIGRATION_URL "$NODE_BIN" -e '
      const sql = require("postgres")(process.env.U, { max: 1, connect_timeout: 3, onnotice() {} })
      sql`select 1`.then(() => process.exit(0), () => process.exit(1))' 2>/dev/null); then
      ok "Postgres is up on 127.0.0.1:$PG_PORT"
      return
    fi
    if systemctl --user is-failed --quiet "$PG_UNIT"; then break; fi
    sleep 1
  done
  show_logs "$PG_UNIT"
  die "Postgres did not come up."
}

setup_embedded_pg() {
  step "Postgres (embedded)"
  ask_port PG_PORT "Port for Postgres on 127.0.0.1" "$(port_in_use 5432 && echo 5433 || echo 5432)"
  install_embedded_files || true
  local owner app auth
  owner=$(secret) app=$(secret) auth=$(secret)
  write_file "$PG_HOME/.env" 600 <<EOF
# Written by deploy/install.sh. Role passwords are applied on every start;
# POSTGRES_PASSWORD only when the data directory is created.
PG_PORT=$PG_PORT
POSTGRES_PASSWORD=$(secret)
KANBAN_OWNER_PASSWORD=$owner
KANBAN_APP_PASSWORD=$app
KANBAN_AUTH_PASSWORD=$auth
EOF
  DB_HOST=127.0.0.1 APP_PW=$app AUTH_PW=$auth
  MIGRATION_URL=postgres://kanban_owner:$owner@127.0.0.1:$PG_PORT/kanban
  write_pg_unit
  run systemctl --user daemon-reload
  run systemctl --user enable --now "$PG_UNIT"
  wait_pg
}

# ---------------------------------------------------------------- database: existing server

setup_system_pg() {
  step "Postgres (existing server)"
  local hostport su owner app auth ver
  ask hostport "Postgres host:port" "127.0.0.1:5432"
  DB_HOST=${hostport%:*} PG_PORT=${hostport##*:}
  owner=$(secret) app=$(secret) auth=$(secret)
  APP_PW=$app AUTH_PW=$auth
  MIGRATION_URL=postgres://kanban_owner:$owner@$DB_HOST:$PG_PORT/kanban
  say "Setting up needs a Postgres superuser once (create the database kanban and three roles)."
  ask su "Superuser URL, e.g. postgres://postgres:<password>@$hostport/postgres (blank: show the commands for an admin)" ''
  if [[ -n $su ]]; then
    if ! dry; then
      ver=$(psql "$su" -XtAc 'show server_version_num') || die "Cannot connect with that URL."
      ((ver >= 170000)) || warn "Postgres $ver: Kanso is built and tested on Postgres 17."
      [[ -z $(psql "$su" -XtAc "select 1 from pg_roles where rolname = 'kanban_owner'") ]] \
        || die "The kanban_* roles already exist, with passwords this script does not know. Drop them (and the kanban database) or set up by hand (docs/DEPLOYMENT.md)."
      [[ -n $(psql "$su" -XtAc "select 1 from pg_database where datname = 'kanban'") ]] \
        || run psql "$su" -X -v ON_ERROR_STOP=1 -c 'CREATE DATABASE kanban'
    fi
    run psql "$su" -X -q -v ON_ERROR_STOP=1 -v owner_pw="$owner" -v app_pw="$app" -v auth_pw="$auth" -f docker/init.sql
  else
    say ""
    say "Ask an admin to run these on the database server (they hold new passwords; nothing else needs them):"
    say ""
    say "  sudo -u postgres createdb kanban"
    say "  sudo -u $USER_NAME cat $REPO/docker/init.sql | sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d kanban \\"
    say "    -v owner_pw=$owner -v app_pw=$app -v auth_pw=$auth -f -"
    say ""
    dry || ask su "Press Enter once that is done" ''
  fi
  if ! dry; then
    psql "$MIGRATION_URL" -XtAc 'select 1' >/dev/null || die "kanban_owner cannot connect to $DB_HOST:$PG_PORT. Check the setup and pg_hba.conf (password login over TCP)."
    ok "Database ready."
  fi
}

# ---------------------------------------------------------------- app (systemd)

write_app_unit() {
  local deps=''
  [[ $MODE == systemd-embedded ]] && deps="Requires=$PG_UNIT
After=$PG_UNIT"
  write_file "$UNIT_DIR/$APP_UNIT" 644 <<EOF
# Written by deploy/install.sh
[Unit]
Description=Kanso
$deps

[Service]
WorkingDirectory=$KANSO_HOME/app
EnvironmentFile=$KANSO_HOME/app/.env
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=$APP_PORT
ExecStart=$NODE_BIN .output/server/index.mjs
Restart=on-failure
NoNewPrivileges=true

[Install]
WantedBy=default.target
EOF
}

write_app_env() {
  local base_line='# NUXT_APP_BASE_URL='
  [[ $BASE_URL == / ]] || base_line="NUXT_APP_BASE_URL=$BASE_URL"
  write_file "$KANSO_HOME/app/.env" 600 <<EOF
# Written by deploy/install.sh. After editing: systemctl --user restart kanso
# (NUXT_APP_BASE_URL is fixed at build time: change it in ~/.config/kanso/install.conf too and run the script again.)
NUXT_DATABASE_URL=postgres://kanban_app:$APP_PW@$DB_HOST:$PG_PORT/kanban
NUXT_AUTH_DATABASE_URL=postgres://kanban_auth:$AUTH_PW@$DB_HOST:$PG_PORT/kanban
NUXT_SESSION_PASSWORD=$(secret)
NUXT_PUBLIC_SITE_URL=$(env_value "$SITE_URL")
$base_line
NUXT_ADMIN_EMAIL=$(env_value "$ADMIN_EMAIL")
NUXT_MAIL_SMTP_URL=$(env_value "$SMTP_URL")
NUXT_MAIL_FROM=$(env_value "$MAIL_FROM")

# Optional sign-in providers. Callback URL: $SITE_URL/auth/<provider>
NUXT_OAUTH_DISCORD_CLIENT_ID=
NUXT_OAUTH_DISCORD_CLIENT_SECRET=
NUXT_OAUTH_GITHUB_CLIENT_ID=
NUXT_OAUTH_GITHUB_CLIENT_SECRET=
NUXT_OAUTH_GOOGLE_CLIENT_ID=
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=
EOF
}

wait_http() {
  dry && return
  local url="http://127.0.0.1:$APP_PORT$BASE_URL" i
  for ((i = 0; i < 60; i++)); do
    if U=$url "$NODE_BIN" -e 'fetch(process.env.U).then(r => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))' 2>/dev/null; then
      ok "Kanso answers on $url"
      return
    fi
    sleep 1
  done
  show_logs "$APP_UNIT"
  die "Kanso did not answer on $url. The previous build is kept in $KANSO_HOME/app/.output.old."
}

# Build, migrate, swap .output, restart. Also the update path.
release() {
  step "Build"
  unset NODE_ENV # dev dependencies are needed to build
  export NUXT_APP_BASE_URL=$BASE_URL
  run pnpm install --frozen-lockfile
  run pnpm build
  step "Database migrations"
  # The environment wins over a .env in the checkout (drizzle.config.ts loads it with dotenv).
  MIGRATION_DATABASE_URL=$MIGRATION_URL run pnpm db:migrate
  step "Start"
  local app=$KANSO_HOME/app
  run mkdir -p "$app"
  run rm -rf "$app/.output.new"
  run cp -a .output "$app/.output.new"
  if [[ -d $app/.output ]] || dry; then
    run rm -rf "$app/.output.old"
    run mv "$app/.output" "$app/.output.old"
  fi
  run mv "$app/.output.new" "$app/.output"
  run systemctl --user daemon-reload
  run systemctl --user enable "$APP_UNIT"
  run systemctl --user restart "$APP_UNIT"
  wait_http
}

# ---------------------------------------------------------------- reverse proxy

APACHE_CONF=$KANSO_HOME/apache-kanso.conf

write_apache_conf() {
  local base=$BASE_URL target="http://127.0.0.1:$APP_PORT$BASE_URL" redirect=''
  [[ $base == / ]] || redirect="RedirectMatch 301 ^${base%/}\$ $base"
  write_file "$APACHE_CONF" 644 <<EOF
# Kanso at $SITE_URL (written by deploy/install.sh).
# Include it inside the existing <VirtualHost *:443> of ${SITE_HOST%%:*}.
# Needs: a2enmod proxy proxy_http headers
$redirect
<Location $base>
    ProxyPass        $target flushpackets=on
    ProxyPassReverse $target
    ProxyPreserveHost On
    # mod_proxy appends the client address to X-Forwarded-For: drop any value the
    # client sent, so the header holds only the real address (rate limits use it).
    RequestHeader unset X-Forwarded-For
    RequestHeader set X-Forwarded-Proto "https"
</Location>
# Server-Sent Events (live updates): no compression
SetEnvIf Request_URI "^${base}.*/events\$" no-gzip=1
EOF
}

# ---------------------------------------------------------------- docker

# set_env FILE KEY VALUE: replace KEY= (or a commented "# KEY=") line, else append.
set_env() {
  K=$2 V=$(env_value "$3") awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    !done && ($0 ~ "^" k "=" || $0 ~ "^# *" k "=") { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$1" >"$1.new"
  mv "$1.new" "$1"
}

setup_docker() {
  step "Docker"
  local caddy=0 tmp
  if ask_yn "Run the bundled Caddy for HTTPS (ports 80 and 443 free on this host)?" n; then caddy=1
  else ask_port APP_PORT "Port for the app on 127.0.0.1 (your reverse proxy forwards there)" 3000; fi
  if [[ -f .env ]]; then
    warn "Replacing $REPO/.env (kept as .env.bak)."
    run cp .env .env.bak
  fi
  tmp=$(mktemp)
  cp .env.example "$tmp"
  set_env "$tmp" NUXT_SESSION_PASSWORD "$(secret)"
  set_env "$tmp" POSTGRES_PASSWORD "$(secret)"
  set_env "$tmp" KANBAN_OWNER_PASSWORD "$(secret)"
  set_env "$tmp" KANBAN_APP_PASSWORD "$(secret)"
  set_env "$tmp" KANBAN_AUTH_PASSWORD "$(secret)"
  set_env "$tmp" KANBAN_DOMAIN "${SITE_HOST%%:*}"
  [[ $BASE_URL == / ]] || set_env "$tmp" NUXT_APP_BASE_URL "$BASE_URL"
  set_env "$tmp" NUXT_ADMIN_EMAIL "$ADMIN_EMAIL"
  set_env "$tmp" NUXT_PUBLIC_SITE_URL "$SITE_URL"
  set_env "$tmp" NUXT_MAIL_SMTP_URL "$SMTP_URL"
  set_env "$tmp" NUXT_MAIL_FROM "$MAIL_FROM"
  if ((caddy)); then set_env "$tmp" COMPOSE_PROFILES caddy; else set_env "$tmp" KANBAN_APP_PORT "127.0.0.1:$APP_PORT"; fi
  write_file "$REPO/.env" 600 <"$tmp"
  rm -f "$tmp"
  ((caddy)) && APP_PORT=caddy
}

docker_release() {
  step "Build and start (docker compose)"
  run docker compose -f docker-compose.prod.yml up -d --build
  dry || docker compose -f docker-compose.prod.yml ps
}

# ---------------------------------------------------------------- summary

summary() {
  step "Done"
  if [[ $MODE == docker ]]; then
    say "Secrets: $REPO/.env"
    if [[ $APP_PORT == caddy ]]; then say "Caddy serves https://${SITE_HOST%%:*} once DNS points here."
    else
      say "The app listens on 127.0.0.1:$APP_PORT. An Apache snippet for it: $APACHE_CONF"
    fi
  else
    say "App:      $KANSO_HOME/app (settings and secrets in .env)"
    [[ $MODE == systemd-embedded ]] && say "Postgres: $PG_HOME (.env), data in $KANSO_HOME/pg-data"
    say "Services: systemctl --user status $APP_UNIT$([[ $MODE == systemd-embedded ]] && echo " $PG_UNIT")"
  fi
  if [[ $MODE != docker || $APP_PORT != caddy ]]; then
    cat <<EOF

${B}Apache${N} (needs an admin, once). The snippet is in $APACHE_CONF:
  sudo cp $APACHE_CONF /etc/apache2/kanso.conf
  sudo a2enmod proxy proxy_http headers
  # add this line inside the <VirtualHost *:443> block of ${SITE_HOST%%:*}:
  #   Include /etc/apache2/kanso.conf
  sudo apachectl configtest && sudo systemctl reload apache2
Then sign in and open Account > Sessions: it must show your own IP address, not 127.0.0.1.
EOF
  fi
  cat <<EOF

${B}Next${N}
  - Open $SITE_URL and sign up as $ADMIN_EMAIL (it becomes the instance admin).
  - Sign-in with Discord/GitHub/Google: keys in the .env above, callback $SITE_URL/auth/<provider>.
  - Backups: docs/DEPLOYMENT.md, "Backups".
  - Update: git pull as $USER_NAME, then run $REPO/deploy/install.sh again.
EOF
}

# ---------------------------------------------------------------- main

ADMIN_EMAIL=${ADMIN_EMAIL:-} SITE_HOST=''
((DRY_RUN)) && warn "Dry run: nothing is installed, written or started."

if [[ -f $CONF ]]; then
  # shellcheck source=/dev/null
  . "$CONF"
  SITE_HOST=${SITE_URL#*://} SITE_HOST=${SITE_HOST%%/*}
  step "Existing $MODE install for $SITE_URL"
  ask_yn "Update it (build, migrate, restart)?" y || exit 0
  if [[ $MODE == docker ]]; then
    docker_release
  else
    user_systemd_ready
    setup_node
    if [[ $MODE == systemd-embedded ]]; then
      write_pg_unit
      if install_embedded_files; then
        run systemctl --user daemon-reload
        run systemctl --user restart "$PG_UNIT"
        wait_pg
      fi
    fi
    write_app_unit
    save_conf # NODE_BIN may have changed
    release
    write_apache_conf
  fi
  ADMIN_EMAIL=$({ sed -n 's/^NUXT_ADMIN_EMAIL=//p' "$KANSO_HOME/app/.env" "$REPO/.env" 2>/dev/null || true; } | head -n1 | tr -d "'")
  summary
  exit 0
fi

choose_mode
if [[ $MODE == docker ]]; then
  ask_site
  setup_docker
  [[ $APP_PORT == caddy ]] || write_apache_conf
  save_conf
  docker_release
  summary
  exit 0
fi

user_systemd_ready
ask_site
step "App"
ask_port APP_PORT "Port for the app on 127.0.0.1 (Apache forwards there)" 3000
setup_node
if [[ $MODE == systemd-embedded ]]; then setup_embedded_pg; else setup_system_pg; fi
write_app_env
write_app_unit
save_conf # from here on, running the script again updates
release
write_apache_conf
summary
