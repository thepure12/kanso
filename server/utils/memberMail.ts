import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'

/**
 * After a members POST: mails an invite (no account, `userId` null) or an
 * "added to" message (an account that was not a member before), once the
 * transaction has committed. Adding yourself or changing a role sends nothing.
 */
export async function mailNewMember(event: H3Event, tx: Tx, p: {
  callerId: string
  email: string
  userId: string | null
  wasMember: boolean
  target: Omit<MembershipTarget, 'name'>
}) {
  if (p.wasMember || p.userId === p.callerId) return
  const table = p.target.kind === 'team' ? schema.teams : schema.boards
  const [[target], [caller]] = await Promise.all([
    tx.select({ name: table.name }).from(table).where(eq(table.id, p.target.id)),
    tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, p.callerId)),
  ])
  if (!target || !caller) return
  const full = { ...p.target, name: target.name }
  const userId = p.userId
  runAfterCommit(event, () => userId
    ? sendAddedEmail(event, { userId, to: p.email, target: full, inviter: caller.name })
    : sendInviteEmail(event, { to: p.email, target: full, inviterId: p.callerId, inviter: caller.name }))
}
