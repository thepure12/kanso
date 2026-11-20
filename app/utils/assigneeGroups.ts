import type { AssigneeGroup } from '#shared/types/board'

/**
 * Assignee groups stand in pickers and filters next to people under this
 * key, so one list (and the saved view filter) can hold both.
 */
export const assigneeGroupKey = (id: string) => `group:${id}`

/** The group id of a key from assigneeGroupKey, else null. */
export const assigneeGroupId = (key: string) => key.startsWith('group:') ? key.slice(6) : null

/** Groups in the server's order: by name, case-insensitively. */
export const sortAssigneeGroups = <T extends { name: string }>(list: T[]) =>
  list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

/**
 * Replaces group keys among ids with the group's members (unknown groups
 * drop out), keeping the first place of each person and dropping duplicates.
 */
export function expandAssigneeGroups(ids: readonly string[], groups: readonly Pick<AssigneeGroup, 'id' | 'userIds'>[]): string[] {
  const out = new Set<string>()
  for (const key of ids) {
    const groupId = assigneeGroupId(key)
    if (groupId === null) out.add(key)
    else for (const u of groups.find(g => g.id === groupId)?.userIds ?? []) out.add(u)
  }
  return [...out]
}
