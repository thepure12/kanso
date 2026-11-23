import type { H3Event } from 'h3'

/** Single-quoted for sh: 'it'"'"'s'. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`
}

/**
 * The site the CLI is installed from and logs in to: NUXT_PUBLIC_SITE_URL (includes
 * the base path), else the request origin plus the base path (development).
 */
export function cliSiteUrl(event: H3Event): string {
  const configured = useRuntimeConfig().public.siteUrl
  if (configured) return configured.replace(/\/+$/, '')
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin + appPath('')
}

/**
 * POSIX sh installer served at /cli/install.sh: downloads <site>/cli/kanso.mjs into
 * $KANSO_BIN_DIR (default ~/.local/bin) as `kanso`. Needs Node 22+ and curl or wget.
 */
export function cliInstallScript(site: string): string {
  return `#!/bin/sh
# Installs the kanso CLI from ${site.replace(/[\r\n]/g, '')}
# Usage: curl -fsSL <site>/cli/install.sh | sh
# KANSO_BIN_DIR: where to put it (default ~/.local/bin). Run it again to update.
set -eu

site=${shellQuote(site)}
bin_dir="\${KANSO_BIN_DIR:-$HOME/.local/bin}"

fail() { echo "kanso install: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js 22 or newer is needed (node not found)"
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] 2>/dev/null || fail "Node.js 22 or newer is needed (found $(node --version))"

mkdir -p "$bin_dir"
tmp=$(mktemp "$bin_dir/.kanso.XXXXXX")
trap 'rm -f "$tmp"' EXIT INT TERM

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$site/cli/kanso.mjs" -o "$tmp" || fail "could not download $site/cli/kanso.mjs"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp" "$site/cli/kanso.mjs" || fail "could not download $site/cli/kanso.mjs"
else
  fail "curl or wget is needed"
fi
[ "$(head -c 2 "$tmp")" = '#!' ] || fail "$site/cli/kanso.mjs is not the kanso CLI"

chmod 755 "$tmp"
mv -f "$tmp" "$bin_dir/kanso"
trap - EXIT INT TERM

echo "Installed kanso $(node "$bin_dir/kanso" --version) to $bin_dir/kanso"
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "Note: $bin_dir is not on your PATH. Add it, e.g. export PATH=\\"$bin_dir:\\$PATH\\"" ;;
esac
echo "Next: kanso login --url $site"
`
}
