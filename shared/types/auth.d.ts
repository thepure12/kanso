declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string
    avatarUrl: string | null
  }

  interface UserSession {
    /** The account's `session_version` at sign-in; withUser rejects older ones. */
    sessionVersion?: number
  }

  /** Server-only session fields (never sent to the browser). */
  interface SecureSessionData {
    /** The `user_sessions` row of this sign-in; withUser rejects revoked rows. */
    sessionId?: string
    /** Password (or OAuth, link) step passed, waiting for the TOTP or recovery code at /login/2fa. */
    pendingTwoFactor?: { userId: string, version: number, expiresAt: number }
  }
}

export {}
