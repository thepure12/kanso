import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { ProgramResult } from './io.ts'
import { run } from './main.ts'

/** Reads the token: without echo on a terminal, else the first line of stdin. */
async function readSecret(prompt: string): Promise<string> {
  const input = process.stdin
  if (!input.isTTY) {
    let text = ''
    for await (const chunk of input) text += chunk
    return text.split(/\r?\n/)[0] ?? ''
  }
  const rl = createInterface({ input, output: process.stderr, terminal: true })
  process.stderr.write(prompt)
  // Hide the typed characters; readline writes them through _writeToOutput.
  ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {}
  try {
    return await new Promise<string>(resolve => rl.question('', resolve))
  } finally {
    rl.close()
    process.stderr.write('\n')
  }
}

/** One question on the terminal; null on Ctrl+D or Ctrl+C. A fresh interface per question, so readSecret can take stdin in between. */
function ask(question: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  return new Promise((done) => {
    let answered = false
    rl.on('SIGINT', () => rl.close())
    rl.on('close', () => {
      if (answered) return
      process.stdout.write('\n')
      done(null)
    })
    rl.question(question, (answer) => {
      answered = true
      rl.close()
      done(answer)
    })
  })
}

/** Runs a program (systemctl, loginctl) without a shell; code null when it cannot be started. */
function runProgram(file: string, args: string[]): Promise<ProgramResult> {
  return new Promise((done) => {
    execFile(file, args, { encoding: 'utf8', timeout: 60_000 }, (err, stdout, stderr) => {
      const code = (err as NodeJS.ErrnoException | null)?.code
      if (typeof code === 'string') done({ code: null, stdout: '', stderr: err!.message })
      else done({ code: err ? (typeof code === 'number' ? code : 1) : 0, stdout, stderr })
    })
  })
}

// A reader that stops early (kanso cards ls | head) closes the pipe: stop quietly.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0)
    throw err
  })
}

// SIGINT/SIGTERM stop long-running commands gracefully; a second one exits at once.
const stop = new AbortController()
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stop.signal.aborted) process.exit(130)
    stop.abort()
  })
}

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  stdout: text => process.stdout.write(text),
  stderr: text => process.stderr.write(text),
  readSecret,
  ask,
  interactive: !!process.stdin.isTTY && !!process.stdout.isTTY,
  fetch: globalThis.fetch,
  signal: stop.signal,
  self: { node: process.execPath, script: resolve(process.argv[1] ?? ''), cwd: process.cwd() },
  runProgram,
}).catch((err: unknown) => {
  process.stderr.write(`kanso: unexpected error: ${(err as Error)?.stack ?? err}\n`)
  return 1
})
