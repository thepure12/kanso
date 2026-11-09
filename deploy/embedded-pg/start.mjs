// Runs Postgres 17 from the embedded-postgres npm package, for servers without
// a system Postgres or Docker. See docs/DEPLOYMENT.md, "systemd without a
// Postgres install".
//
// Environment:
//   PGDATA_DIR             data directory (default ./data); created on first start
//   PG_PORT                TCP port on 127.0.0.1 (default 5432)
//   POSTGRES_PASSWORD      superuser password, fixed at the first start
//   KANBAN_OWNER_PASSWORD, KANBAN_APP_PASSWORD, KANBAN_AUTH_PASSWORD
//                          role passwords, applied on every start
//
// On every start it makes sure the database `kanban` and the three roles exist,
// as docker/init.sql does. The schema itself comes from `pnpm db:migrate`.
import EmbeddedPostgres from 'embedded-postgres'
import postgres from 'postgres'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Passwords go into connection URLs and SQL literals: letters and digits only.
function secret(name) {
  const value = process.env[name]
  if (!value || !/^[A-Za-z0-9]{16,}$/.test(value)) {
    console.error(`${name} must be set to at least 16 letters or digits (openssl rand -hex 32)`)
    process.exit(1)
  }
  return value
}

const dataDir = resolve(process.env.PGDATA_DIR || 'data')
const port = Number(process.env.PG_PORT || 5432)
const superPassword = secret('POSTGRES_PASSWORD')
const roles = {
  kanban_owner: secret('KANBAN_OWNER_PASSWORD'),
  kanban_app: secret('KANBAN_APP_PASSWORD'),
  kanban_auth: secret('KANBAN_AUTH_PASSWORD'),
}

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: superPassword,
  authMethod: 'scram-sha-256',
  port,
  persistent: true,
  // TCP on loopback only; no Unix socket (nothing here uses one).
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories='],
})

let stopping = false
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  await pg.stop() // SIGINT: fast shutdown, does not wait for the app's connections
  process.exit(code)
}
process.on('SIGTERM', () => stop())
process.on('SIGINT', () => stop())

if (!existsSync(resolve(dataDir, 'PG_VERSION'))) {
  console.log(`Initialising a new cluster in ${dataDir}`)
  await pg.initialise()
}
await pg.start()
// If Postgres exits on its own, exit too, so systemd restarts both.
pg.process?.on('exit', (code) => {
  if (!stopping) {
    console.error(`postgres exited unexpectedly (code ${code})`)
    process.exit(1)
  }
})

const connect = (database) =>
  postgres({ host: '127.0.0.1', port, user: 'postgres', password: superPassword, database, max: 1, onnotice: () => {} })

try {
  const su = connect('postgres')
  for (const [role, password] of Object.entries(roles)) {
    const [{ exists }] = await su`select exists (select 1 from pg_roles where rolname = ${role})`
    await su.unsafe(
      `${exists ? 'ALTER' : 'CREATE'} ROLE ${role} LOGIN PASSWORD '${password}' NOBYPASSRLS`,
    )
  }
  const [{ exists: hasDb }] = await su`select exists (select 1 from pg_database where datname = 'kanban')`
  if (!hasDb) {
    console.log('Creating database kanban')
    await su.unsafe('CREATE DATABASE kanban OWNER kanban_owner')
  }
  await su.end()

  const db = connect('kanban')
  await db.unsafe(`ALTER SCHEMA public OWNER TO kanban_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS citext;`)
  await db.end()
} catch (error) {
  console.error('Database setup failed:', error)
  await stop(1)
}

console.log(`READY: Postgres on 127.0.0.1:${port}, data in ${dataDir}`)
