// OAuth providers with credentials configured, so the login page only shows working buttons.
export default defineEventHandler(() => {
  const oauth = useRuntimeConfig().oauth as Record<string, { clientId?: string } | undefined>
  return (['discord', 'github', 'google'] as const).filter(p => !!oauth?.[p]?.clientId)
})
