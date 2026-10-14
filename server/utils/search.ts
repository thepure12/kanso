/**
 * Turns free text into a tsquery for the 'simple' config where every word must
 * match the start of an indexed word ("desi rev" finds "design review"). Only
 * letters and digits are kept, so user input cannot inject tsquery syntax.
 * Null when the text has no words.
 */
export function toPrefixTsquery(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu)
  if (!words) return null
  return [...new Set(words)].slice(0, 10).map(w => `${w}:*`).join(' & ')
}
