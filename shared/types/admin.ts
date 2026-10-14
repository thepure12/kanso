import type { SignupMode } from '../signup'

export interface InstanceSettings {
  signupMode: SignupMode
  allowedDomains: string[]
  allowedEmails: string[]
  allowExternalInvites: boolean
}

export interface AdminUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  createdAt: string
  verified: boolean
  isAdmin: boolean
}

/** An admin_audit_log entry. data holds actor_/target_ email and name, plus action details. */
export interface AuditEntry {
  id: string
  action: string
  actorId: string | null
  targetUserId: string | null
  data: Record<string, unknown>
  createdAt: string
}

export interface AuditLogPage {
  entries: AuditEntry[]
  total: number
  pageSize: number
}
