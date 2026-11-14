import type { Locale } from '../i18n'
import type { NotificationPrefs } from '../notificationSettings'

/** GET /api/me. */
export interface Me {
  isAdmin: boolean
  /** Saved UI language; null = follow the browser. */
  locale: Locale | null
}

export interface Account {
  name: string
  email: string
  /** Uploaded picture (GET /api/users/:id/avatar) or one from an OAuth provider. */
  avatarUrl: string | null
  /** False for accounts that only sign in through OAuth; they can set one. */
  hasPassword: boolean
  /** Linked OAuth providers, e.g. ['github']. */
  providers: string[]
  digestEnabled: boolean
  /** Channels per notification event; missing = on. */
  notificationPrefs: NotificationPrefs
  /** Whether cards the user only watches notify. */
  notifyWatching: boolean
  locale: Locale | null
  twoFactorEnabled: boolean
  /** Unused two-factor recovery codes. */
  recoveryCodesLeft: number
}

/** A signed-in device (GET /api/account/sessions). */
export interface AccountSession {
  id: string
  createdAt: string
  lastSeenAt: string
  userAgent: string | null
  ip: string | null
  /** The session making the request. */
  current: boolean
}

/** A personal access token (GET /api/account/tokens). The token itself is only returned on creation. */
export interface ApiToken {
  id: string
  name: string
  /** The first characters, to tell tokens apart, e.g. "kb_Ab12Cd". */
  prefix: string
  scopes: ('read' | 'write')[]
  /** Boards a limited token reaches (ones the user still sees); null = every board. */
  boards: { id: string, name: string }[] | null
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

/** A browser that receives push notifications (GET /api/account/push). */
export interface PushDevice {
  id: string
  endpoint: string
  userAgent: string | null
  createdAt: string
  lastSuccessAt: string | null
}

/** GET /api/account/push: the server's VAPID public key and the user's push devices. */
export interface PushSettings {
  publicKey: string
  devices: PushDevice[]
}
