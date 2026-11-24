import { CliError } from './io.ts'

/** Small interactive prompts over one "read a line" function, so tests can script the answers. */

/** Reads one answer after showing `question`; null when the input ended (Ctrl+D, Ctrl+C). */
export type AskLine = (question: string) => Promise<string | null>

export interface Choice<T> {
  label: string
  value: T
  /** Shown after the label, dimmed in spirit: "(3 active rules)". */
  hint?: string
}

export class Cancelled extends CliError {
  constructor() {
    super('Cancelled; nothing was changed.')
  }
}

export interface Prompter {
  /** Free text; empty input takes `def`. `check` returns an error to show and ask again, or null. */
  text: (question: string, opts?: { default?: string, check?: (value: string) => string | null }) => Promise<string>
  /** y/n; empty input takes `def`. */
  confirm: (question: string, def: boolean) => Promise<boolean>
  /** One item of a numbered list; empty input takes the default (index). */
  pickOne: <T>(question: string, choices: Choice<T>[], def?: number) => Promise<T>
  /** Several items: "1,3", "2-4", "all"; empty input takes the defaults (indexes). */
  pickMany: <T>(question: string, choices: Choice<T>[], defaults?: number[], opts?: { allowNone?: boolean }) => Promise<T[]>
  /** A line of text (headings, notes). */
  say: (text: string) => void
}

/** Parses "1,3-4", "all" or "none" against `count` items into 0-based indexes; null when invalid. */
export function parseSelection(input: string, count: number): number[] | null {
  const text = input.trim().toLowerCase()
  if (text === 'all' || text === '*') return [...Array(count).keys()]
  if (text === 'none' || text === '-') return []
  const picked = new Set<number>()
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!m) return null
    const from = Number(m[1])
    const to = m[2] === undefined ? from : Number(m[2])
    if (from < 1 || to > count || from > to) return null
    for (let i = from; i <= to; i++) picked.add(i - 1)
  }
  return [...picked].sort((a, b) => a - b)
}

export function createPrompter(ask: AskLine, write: (text: string) => void): Prompter {
  const line = async (question: string): Promise<string> => {
    const answer = await ask(question)
    if (answer === null) throw new Cancelled()
    return answer.trim()
  }
  const list = <T>(choices: Choice<T>[], marked: (i: number) => boolean) => {
    const width = String(choices.length).length
    write(choices.map((c, i) => `  ${marked(i) ? '*' : ' '}${String(i + 1).padStart(width)}) ${c.label}${c.hint ? `  (${c.hint})` : ''}\n`).join(''))
  }
  return {
    say: text => write(`${text}\n`),
    async text(question, opts = {}) {
      for (;;) {
        const answer = await line(`${question}${opts.default ? ` [${opts.default}]` : ''}: `) || opts.default || ''
        const problem = opts.check?.(answer) ?? null
        if (!problem) return answer
        write(`  ${problem}\n`)
      }
    },
    async confirm(question, def) {
      for (;;) {
        const answer = (await line(`${question} [${def ? 'Y/n' : 'y/N'}]: `)).toLowerCase()
        if (!answer) return def
        if (['y', 'yes'].includes(answer)) return true
        if (['n', 'no'].includes(answer)) return false
        write('  Answer y or n.\n')
      }
    },
    async pickOne(question, choices, def = 0) {
      write(`${question}\n`)
      list(choices, i => i === def)
      for (;;) {
        const answer = await line(`Choose 1-${choices.length} [${def + 1}]: `)
        if (!answer) return choices[def]!.value
        const n = Number(answer)
        if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1]!.value
        write(`  Enter a number from 1 to ${choices.length}.\n`)
      }
    },
    async pickMany(question, choices, defaults = [], opts = {}) {
      write(`${question}\n`)
      list(choices, i => defaults.includes(i))
      const def = defaults.length ? defaults.map(i => i + 1).join(',') : (opts.allowNone ? 'none' : '')
      for (;;) {
        const answer = await line(`Choose numbers, e.g. 1,3 or 2-4 or all${def ? ` [${def}]` : ''}: `)
        const picked = answer ? parseSelection(answer, choices.length) : defaults
        if (picked && (picked.length || opts.allowNone)) return picked.map(i => choices[i]!.value)
        write(picked ? '  Pick at least one.\n' : `  Use numbers from 1 to ${choices.length}, ranges like 2-4, or all.\n`)
      }
    },
  }
}

/** One shell word: plain when safe, else single-quoted. */
export function shellQuote(arg: string): string {
  if (/^[\w@%+=:,./-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}
