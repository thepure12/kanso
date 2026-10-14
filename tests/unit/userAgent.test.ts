import { describe, expect, it } from 'vitest'
import { describeUserAgent as describe_, deviceIcon } from '../../app/utils/userAgent'
import { serverI18n } from '../../server/utils/i18n'

const describeUserAgent = (ua: string | null) => describe_(ua, serverI18n('en').t)

describe('describeUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15', 'Safari on macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1', 'Safari on iOS'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['curl/8.5.0', 'curl'],
    ['node', 'Unknown device'],
    [null, 'Unknown device'],
  ])('%s', (ua, label) => {
    expect(describeUserAgent(ua)).toBe(label)
  })

  it('speaks German', () => {
    expect(describe_('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', serverI18n('de').t)).toBe('Firefox auf Linux')
    expect(describe_(null, serverI18n('de').t)).toBe('Unbekanntes Gerät')
  })

  it('picks a phone icon for mobile agents', () => {
    expect(deviceIcon('Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) Mobile/15E148')).toBe('i-lucide-smartphone')
    expect(deviceIcon('Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0')).toBe('i-lucide-monitor')
  })
})
