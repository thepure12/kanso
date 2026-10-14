import type { ActivityKind } from './types/board'

// Every activity kind once: `satisfies` fails to compile when ActivityKind gains one.
const kinds = {
  created: 1, moved: 1, renamed: 1, described: 1, start: 1, due: 1, priority: 1, estimate: 1, archived: 1, restored: 1,
  tagged: 1, untagged: 1, assigned: 1, unassigned: 1, commented: 1, mentioned: 1, attached: 1, detached: 1,
  linked: 1, unlinked: 1, field: 1,
} satisfies Record<ActivityKind, 1>

/** What a webhook can be limited to: activity kinds (an empty list sends all). */
export const webhookEvents = Object.keys(kinds) as ActivityKind[]

export const webhookFormats = ['json', 'slack', 'discord'] as const
export type WebhookFormat = (typeof webhookFormats)[number]

export const apiTokenScopes = ['read', 'write'] as const
export type ApiTokenScope = (typeof apiTokenScopes)[number]
