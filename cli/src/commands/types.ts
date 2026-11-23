import type { OptionSpecs, Values } from '../args.ts'
import type { Io } from '../io.ts'

export interface Context {
  io: Io
  values: Values
  positionals: string[]
  /** --json */
  json: boolean
  /** The chosen profile name (--profile, KANSO_PROFILE, "default"). */
  profile: string
  /** The config file path. */
  configPath: string
}

export interface Command {
  name: string
  summary: string
  /** Usage line after "kanso ". */
  usage: string
  options?: OptionSpecs
  /** Extra help text. */
  details?: string
  run: (ctx: Context) => Promise<void>
}
