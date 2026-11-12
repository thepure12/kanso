export const adminTabs = ['users', 'signup', 'audit'] as const
export type AdminTab = typeof adminTabs[number]

/** The tab from `?tab=`, falling back to users for anything unknown. */
export function adminTabFrom(value: unknown): AdminTab {
  return adminTabs.includes(value as AdminTab) ? value as AdminTab : 'users'
}

/** Users whose name or email contains every word of the query (case-insensitive). */
export function filterAdminUsers<T extends { name: string, email: string }>(users: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return users
  return users.filter((u) => {
    const text = `${u.name} ${u.email}`.toLowerCase()
    return words.every(w => text.includes(w))
  })
}
