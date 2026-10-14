import type { Translate } from '#shared/i18n'

/**
 * "Firefox on Linux"-style label from a User-Agent string, for the session
 * list. Deliberately rough: the browser family and the OS, nothing more.
 */
export function describeUserAgent(ua: string | null | undefined, t: Translate): string {
  if (!ua) return t('userAgent.unknown')
  const browser
    = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
      : /OPR\/|Opera/.test(ua) ? 'Opera'
        : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
              : /curl\//i.test(ua) ? 'curl'
                : null
  const os
    = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Android/.test(ua) ? 'Android'
        : /Windows/.test(ua) ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
            : /CrOS/.test(ua) ? 'ChromeOS'
              : /Linux/.test(ua) ? 'Linux'
                : null
  if (browser && os) return t('userAgent.on', { browser, os })
  return browser ?? os ?? t('userAgent.unknown')
}

/** Lucide icon for the device type. */
export function deviceIcon(ua: string | null | undefined): string {
  return ua && /Mobile|iPhone|Android/.test(ua) ? 'i-lucide-smartphone' : 'i-lucide-monitor'
}
