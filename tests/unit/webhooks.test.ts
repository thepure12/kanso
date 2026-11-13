import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { isBlockedAddress, postWebhook, webhookUrlProblem } from '../../server/utils/webhookHttp'
import { serverI18n } from '../../server/utils/i18n'
import { signWebhook, webhookRequest, type WebhookEvent } from '../../server/utils/webhookPayload'

const en = serverI18n('en')

describe('webhook address checks', () => {
  it('blocks loopback, private, link-local, metadata and reserved addresses', () => {
    for (const ip of [
      '127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
      '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1',
      '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:8.8.8.8', '64:ff9b::a00:1', '2002:7f00:1::', 'ff02::1', 'not-an-ip',
    ]) expect(isBlockedAddress(ip), ip).toBe(true)
  })

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1', '2606:4700:4700::1111', '2a00:1450:4001:80b::200e']) {
      expect(isBlockedAddress(ip), ip).toBe(false)
    }
  })

  it('checks URL shape and IP literals', () => {
    expect(webhookUrlProblem('https://hooks.slack.com/services/x', false)).toBeNull()
    expect(webhookUrlProblem('ftp://example.com/', false)).toMatch(/http/)
    expect(webhookUrlProblem('file:///etc/passwd', false)).toMatch(/http/)
    expect(webhookUrlProblem('nonsense', false)).toBe('Invalid URL')
    expect(webhookUrlProblem('https://user:pw@example.com/', false)).toMatch(/credentials/)
    for (const u of ['http://127.0.0.1:3000/', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://2130706433/', 'http://0x7f.1/', 'http://localhost/', 'http://a.localhost/']) {
      expect(webhookUrlProblem(u, false), u).toMatch(/not reachable/)
    }
    expect(webhookUrlProblem('http://127.0.0.1:3000/', true)).toBeNull()
  })
})

describe('postWebhook', () => {
  it('refuses private targets, does not follow redirects and times out', async () => {
    const received: string[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        received.push(`${req.url} ${body}`)
        if (req.url === '/redirect') res.writeHead(302, { location: '/ok' }).end()
        else if (req.url === '/slow') setTimeout(() => res.end(), 500)
        else res.writeHead(req.url === '/ok' ? 204 : 500).end()
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      expect(await postWebhook(`${base}/ok`, '{}', {}, false)).toMatchObject({ ok: false, status: null })
      expect(await postWebhook(`http://localhost:${(server.address() as AddressInfo).port}/ok`, '{}', {}, false)).toMatchObject({ ok: false, status: null })
      expect(received).toEqual([])
      expect(await postWebhook(`${base}/ok`, '{"a":1}', {}, true)).toEqual({ ok: true, status: 204, error: null })
      expect(await postWebhook(`${base}/fail`, '{}', {}, true)).toEqual({ ok: false, status: 500, error: 'HTTP 500', body: '' })
      expect(await postWebhook(`${base}/redirect`, '{}', {}, true)).toMatchObject({ ok: false, status: 302 })
      expect(await postWebhook(`${base}/slow`, '{}', {}, true, 100)).toMatchObject({ ok: false, status: null, error: expect.stringMatching(/Timed out/) })
      expect(received).toEqual(['/ok {"a":1}', '/fail {}', '/redirect {}', '/slow {}'])
    }
    finally {
      server.closeAllConnections()
      server.close()
    }
  })
})

const event: WebhookEvent = {
  deliveryId: 'd1',
  board: { id: 'b1', name: 'Roadmap <2027>' },
  activity: {
    id: 'a1', kind: 'moved', data: { from: 'Todo', to: 'Done' }, createdAt: '2026-10-14T08:00:00.000Z',
    card: { id: 'c1', title: 'Ship *it* | now & <then>' }, actor: { id: 'u1', name: 'Alice' },
  },
}

describe('webhook payloads', () => {
  it('signs json with HMAC-SHA256 over timestamp.body', () => {
    const { body, headers } = webhookRequest('json', event, 'secret', 'https://kanso.example', en, 1_800_000_000_000)
    expect(headers['x-kanban-timestamp']).toBe('1800000000')
    expect(headers['x-kanban-signature']).toBe(`sha256=${createHmac('sha256', 'secret').update(`1800000000.${body}`).digest('hex')}`)
    expect(headers['x-kanban-signature']).toBe(signWebhook('secret', 1_800_000_000, body))
    expect(headers['x-kanban-event']).toBe('moved')
    expect(JSON.parse(body)).toMatchObject({
      event: 'moved', deliveryId: 'd1', text: 'Alice moved this card from Todo to Done',
      card: { id: 'c1', url: 'https://kanso.example/boards/b1?card=c1' },
      board: { id: 'b1', url: 'https://kanso.example/boards/b1' },
      activity: { kind: 'moved', data: { from: 'Todo', to: 'Done' } },
      actor: { id: 'u1', name: 'Alice' },
    })
  })

  it('formats Slack text with escaped titles and a card link', () => {
    const { body, headers } = webhookRequest('slack', event, 'secret', 'https://kanso.example', en)
    expect(JSON.parse(body)).toEqual({
      text: 'Alice moved this card from Todo to Done · <https://kanso.example/boards/b1?card=c1|Ship *it* ¦ now &amp; &lt;then&gt;> on Roadmap &lt;2027&gt;',
    })
    expect(headers['x-kanban-signature']).toBeUndefined()
  })

  it('writes Slack text in the given locale', () => {
    const { body } = webhookRequest('slack', event, 'secret', null, serverI18n('de'))
    expect(JSON.parse(body).text).toBe('Alice hat diese Karte von Todo nach Done verschoben · "Ship *it* | now &amp; &lt;then&gt;" in Roadmap &lt;2027&gt;')
  })

  it('formats Discord content without mentions', () => {
    const { body } = webhookRequest('discord', { ...event, activity: { ...event.activity!, actor: { id: 'u1', name: '@everyone' } } }, 'secret', null, en)
    const parsed = JSON.parse(body)
    expect(parsed.allowed_mentions).toEqual({ parse: [] })
    expect(parsed.content).toBe('@​everyone moved this card from Todo to Done · "Ship \\*it\\* \\| now & <then\\>" on Roadmap <2027\\>')
  })

  it('sends a ping without an activity', () => {
    const { body, headers } = webhookRequest('json', { deliveryId: 'p1', board: { id: 'b1', name: 'Roadmap' } }, 'secret', null, en)
    expect(headers['x-kanban-event']).toBe('ping')
    expect(JSON.parse(body)).toEqual({ event: 'ping', deliveryId: 'p1', text: 'Webhook test from board "Roadmap"', board: { id: 'b1', name: 'Roadmap', url: null } })
  })
})
