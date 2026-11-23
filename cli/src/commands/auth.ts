import type { Me } from '../../../shared/types/account.ts'
import { createClient } from '../client.ts'
import { checkToken, loadConfig, normalizeUrl, resolveCredentials, saveConfig } from '../config.ts'
import { UsageError } from '../io.ts'
import { fields, json } from '../output.ts'
import type { Command, Context } from './types.ts'

export const login: Command = {
  name: 'login',
  summary: 'Store a site URL and API token (checked against the site first)',
  usage: 'login --url <site> [--token <kb_...>] [--profile <name>]',
  options: {
    url: { type: 'string', value: '<site>', description: 'Address of the Kanso site, with its base path (e.g. https://host/kanso)' },
    token: { type: 'string', value: '<kb_...>', description: 'API token; without it (or with "-") it is read from stdin, so it stays out of shell history' },
  },
  details: 'Create a token under Account → API tokens (or a bot\'s token in the board menu → Bots). Logging in again with the same profile replaces it.',
  async run(ctx) {
    const config = await loadConfig(ctx.configPath)
    const existing = config.profiles[ctx.profile]
    const rawUrl = (ctx.values.url as string | undefined) ?? existing?.url
    if (!rawUrl) throw new UsageError('Missing --url <site>.')
    const url = normalizeUrl(rawUrl)
    const given = ctx.values.token as string | undefined
    const token = checkToken(given && given !== '-' ? given : await ctx.io.readSecret('API token: '))

    const me = await createClient({ url, token }, ctx.io.fetch).get<Me>('/api/me')
    config.profiles[ctx.profile] = { url, token }
    await saveConfig(ctx.configPath, config)

    if (ctx.json) {
      ctx.io.stdout(json({ profile: ctx.profile, url, user: me, configPath: ctx.configPath }))
    } else {
      ctx.io.stdout(`Logged in to ${url} as ${me.name} <${me.email}>${me.isBot ? ' (bot)' : ''}, profile "${ctx.profile}".\nSaved to ${ctx.configPath}.\n`)
    }
    if (ctx.io.env.KANSO_URL || ctx.io.env.KANSO_TOKEN) {
      ctx.io.stderr('Note: KANSO_URL / KANSO_TOKEN are set and override the stored values.\n')
    }
  },
}

export const logout: Command = {
  name: 'logout',
  summary: 'Forget the stored URL and token of a profile',
  usage: 'logout [--profile <name>]',
  details: 'The token itself stays valid: revoke it under Account → API tokens.',
  async run(ctx) {
    const config = await loadConfig(ctx.configPath)
    const had = ctx.profile in config.profiles
    if (had) {
      delete config.profiles[ctx.profile]
      await saveConfig(ctx.configPath, config)
    }
    if (ctx.json) {
      ctx.io.stdout(json({ profile: ctx.profile, removed: had }))
    } else {
      ctx.io.stdout(had
        ? `Logged out of profile "${ctx.profile}". The token stays valid until you revoke it under Account → API tokens.\n`
        : `Profile "${ctx.profile}" was not logged in.\n`)
    }
  },
}

export const whoami: Command = {
  name: 'whoami',
  summary: 'Show the user (or bot) the token acts as',
  usage: 'whoami [--profile <name>]',
  async run(ctx: Context) {
    const creds = resolveCredentials(await loadConfig(ctx.configPath), ctx.profile, ctx.io.env)
    const me = await createClient(creds, ctx.io.fetch).get<Me>('/api/me')
    if (ctx.json) {
      ctx.io.stdout(json({ ...me, url: creds.url, profile: creds.profile }))
      return
    }
    const env = [creds.source.url === 'env' && 'KANSO_URL', creds.source.token === 'env' && 'KANSO_TOKEN'].filter(Boolean)
    ctx.io.stdout(fields([
      ['Name', me.name],
      ['Email', me.isBot ? null : me.email],
      ['User id', me.id],
      ['Bot', me.isBot],
      ['Admin', me.isAdmin],
      ['Site', creds.url],
      ['Profile', env.length ? `${creds.profile} (${env.join(', ')} from the environment)` : creds.profile],
    ]))
  },
}
