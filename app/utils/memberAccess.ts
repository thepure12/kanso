import type { BoardAccess, BoardRole, MemberAccess } from '#shared/types/board'

/** Roles that never edit cards (commenters still comment and log time). */
export function readOnlyRole(role: BoardRole | null | undefined): boolean {
  return role === 'viewer' || role === 'commenter'
}

const rank: Record<BoardAccess, number> = { none: 0, read: 1, edit: 2 }

/** Caps an access level by the role: viewers and commenters at most read. Mirrors app.user_access. */
function capped(access: BoardAccess, role: BoardRole | null | undefined): BoardAccess {
  if (!role) return 'none'
  const max: BoardAccess = readOnlyRole(role) ? 'read' : 'edit'
  return rank[access] <= rank[max] ? access : max
}

/** A column's access (cards without their own entry follow it). Null limits = role only. */
export function columnAccess(limits: MemberAccess | null | undefined, role: BoardRole | null | undefined, columnId: string): BoardAccess {
  if (!limits || role === 'owner') return capped('edit', role)
  return capped(limits.columns[columnId] ?? limits.defaultAccess, role)
}

/** A card's access: its own entry, else its column's, else the default. */
export function cardAccess(limits: MemberAccess | null | undefined, role: BoardRole | null | undefined, card: { id: string, columnId: string }): BoardAccess {
  if (!limits || role === 'owner') return capped('edit', role)
  return capped(limits.cards[card.id] ?? limits.columns[card.columnId] ?? limits.defaultAccess, role)
}

