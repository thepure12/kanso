export const accountTabs = ['profile', 'security', 'notifications', 'tokens'] as const
export type AccountTab = typeof accountTabs[number]

/** The tab from `?tab=`, falling back to profile for anything unknown. */
export function accountTabFrom(value: unknown): AccountTab {
  return accountTabs.includes(value as AccountTab) ? value as AccountTab : 'profile'
}
