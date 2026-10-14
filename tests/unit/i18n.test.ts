import { readdirSync, readFileSync } from 'node:fs'
import { baseCompile } from '@intlify/message-compiler'
import { describe, expect, it } from 'vitest'
import { createTranslator, locales } from '../../shared/i18n'

type Messages = { [key: string]: string | Messages }

const dir = new URL('../../i18n/locales/', import.meta.url)
const catalogues = Object.fromEntries(locales.map(l => [l, JSON.parse(readFileSync(new URL(`${l}.json`, dir), 'utf8')) as Messages]))

function flatten(m: Messages, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(m).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v]] : Object.entries(flatten(v, `${prefix}${k}.`))))
}

/** Named placeholders ({name}; not {'literal'}), and the number of plural forms. */
function shape(message: string) {
  const names = [...message.matchAll(/\{\s*(\w+)\s*\}/g)].map(m => m[1]!)
  return { names: [...new Set(names)].sort(), forms: message.split(/\s*\|\s*(?![^{]*\})/).length }
}

const flat = Object.fromEntries(locales.map(l => [l, flatten(catalogues[l]!)]))

describe('locale catalogues', () => {
  it('ships a file per locale', () => {
    expect(readdirSync(dir).filter(f => f.endsWith('.json')).sort()).toEqual(locales.map(l => `${l}.json`).sort())
  })

  it('have the same keys in every locale', () => {
    const en = Object.keys(flat.en!).sort()
    for (const l of locales) expect(Object.keys(flat[l]!).sort(), l).toEqual(en)
  })

  it('use the same placeholders and plural forms as English', () => {
    for (const l of locales) {
      for (const [key, message] of Object.entries(flat[l]!)) {
        const en = flat.en![key]
        if (en === undefined) continue
        expect(shape(message), `${l}: ${key}`).toEqual(shape(en))
      }
    }
  })

  it('compile with vue-i18n (no stray @, { or |)', () => {
    for (const l of locales) {
      for (const [key, message] of Object.entries(flat[l]!)) {
        const errors: string[] = []
        baseCompile(message, { onError: e => errors.push(e.message) })
        expect(errors, `${l}: ${key}`).toEqual([])
      }
    }
  })
})

describe('createTranslator', () => {
  const t = createTranslator({ a: { hi: 'Hi {name}', at: 'a{\'@\'}b', cards: 'no cards | one card | {count} cards', pts: '{p} point | {p} points' } }, { only: 'fallback' })

  it('fills placeholders and literals', () => {
    expect(t('a.hi', { name: 'Ada' })).toBe('Hi Ada')
    expect(t('a.at')).toBe('a@b')
  })

  it('picks plural forms like vue-i18n', () => {
    expect(t('a.cards', {}, 0)).toBe('no cards')
    expect(t('a.cards', {}, 1)).toBe('one card')
    expect(t('a.cards', {}, 5)).toBe('5 cards')
    expect(t('a.pts', { p: '1' }, 1)).toBe('1 point')
    expect(t('a.pts', { p: '2' }, 2)).toBe('2 points')
  })

  it('falls back to the fallback catalogue, then the key', () => {
    expect(t('only')).toBe('fallback')
    expect(t('missing.key')).toBe('missing.key')
  })
})
