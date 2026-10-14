const META = {
  discord: { label: 'Discord', icon: 'i-simple-icons-discord' },
  github: { label: 'GitHub', icon: 'i-simple-icons-github' },
  google: { label: 'Google', icon: 'i-simple-icons-google' },
} as const

/** Buttons for OAuth providers that have credentials configured on the server. */
export async function useProviders() {
  const { data } = await useFetch('/api/auth/providers', { default: () => [] })
  return computed(() => data.value.map(p => ({
    ...META[p],
    color: 'neutral' as const,
    variant: 'subtle' as const,
    onClick: () => { window.location.href = `/auth/${p}` },
  })))
}
