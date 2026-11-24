/** Everything a command touches outside itself, so tests can run commands in-process. */
export interface Io {
  env: Record<string, string | undefined>
  /** Home directory, for ~/.config/kanso when XDG_CONFIG_HOME is unset. */
  home: string
  stdout: (text: string) => void
  stderr: (text: string) => void
  /** Reads a secret (the token) when `kanso login` has no --token: a prompt without echo on a terminal, else one line of stdin. */
  readSecret: (prompt: string) => Promise<string>
  /** Asks one question on the terminal (the agent setup wizard); null when the input ended or Ctrl+C. */
  ask?: (question: string) => Promise<string | null>
  /** stdin and stdout are a terminal, so the wizard may ask questions. */
  interactive?: boolean
  fetch: typeof globalThis.fetch
  /** Aborted on SIGINT/SIGTERM: long-running commands (`kanso agent run`) stop then. */
  signal?: AbortSignal
  /** The running CLI (`kanso agent install` writes these into the systemd unit). */
  self?: { node: string, script: string, cwd: string }
  /** Runs a program without a shell (systemctl, loginctl); `code` is null when it could not be started. */
  runProgram?: (file: string, args: string[]) => Promise<ProgramResult>
}

export interface ProgramResult {
  code: number | null
  stdout: string
  stderr: string
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
