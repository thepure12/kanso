import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
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
  fetch: globalThis.fetch,
  signal: stop.signal,
}).catch((err: unknown) => {
  process.stderr.write(`kanso: unexpected error: ${(err as Error)?.stack ?? err}\n`)
  return 1
})
