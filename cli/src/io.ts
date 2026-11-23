/** Everything a command touches outside itself, so tests can run commands in-process. */
export interface Io {
  env: Record<string, string | undefined>
  /** Home directory, for ~/.config/kanso when XDG_CONFIG_HOME is unset. */
  home: string
  stdout: (text: string) => void
  stderr: (text: string) => void
  /** Reads a secret (the token) when `kanso login` has no --token: a prompt without echo on a terminal, else one line of stdin. */
  readSecret: (prompt: string) => Promise<string>
  fetch: typeof globalThis.fetch
}

/** A failure to report as `error: <message>` with this exit code (1 = failed, 2 = usage). */
export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message)
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2)
  }
}
