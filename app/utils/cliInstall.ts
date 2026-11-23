/** Shell commands shown next to API tokens: install the kanso CLI from this site, then log in. */
export function cliInstallCommand(site: string): string {
  return `curl -fsSL ${site}/cli/install.sh | sh`
}

/** The token is pasted when asked, so it stays out of the shell history. */
export function cliLoginCommand(site: string): string {
  return `kanso login --url ${site}`
}
