import type { Translate } from '#shared/i18n'

/**
 * Parses a duration typed by a person into whole minutes: "1h30m", "1h 30m",
 * "1h30", "2h", "45m", "45" (minutes), "1.5h", "1,5h", "1:30", "1 Std. 30 Min.". Returns null for anything else
 * or for zero.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(',', '.')
  if (!s) return null
  let minutes: number
  const clock = /^(\d+):([0-5]\d)$/.exec(s)
  if (clock) {
    minutes = Number(clock[1]) * 60 + Number(clock[2])
  }
  else if (/^\d+$/.test(s)) {
    minutes = Number(s)
  }
  else {
    // Also the German "1 Std. 30 Min." that formatDuration writes in German.
    const units = /^(?:(\d+(?:\.\d+)?)\s*(?:h(?:ours?|rs?)?|std\.?))?\s*(?:(\d+)\s*(?:m(?:in(?:utes?|s)?)?\.?)?)?$/.exec(s)
    if (!units || (units[1] === undefined && units[2] === undefined)) return null
    minutes = Math.round(Number(units[1] ?? 0) * 60) + Number(units[2] ?? 0)
  }
  return minutes > 0 ? minutes : null
}

/** Minutes as "1h 30m", "2h" or "45m" (time.duration.* keys; German "1 Std. 30 Min."). */
export function formatDuration(minutes: number, t: Translate): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return t('time.duration.m', { m })
  return m ? t('time.duration.hm', { h, m }) : t('time.duration.h', { h })
}
