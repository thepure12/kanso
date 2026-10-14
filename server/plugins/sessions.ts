// Signing out (POST /api/auth/logout, DELETE /api/_auth/session, or a 401 that
// clears the cookie) revokes the session's user_sessions row.
export default defineNitroPlugin(() => {
  sessionHooks.hook('clear', async (session) => {
    await revokeSessionRow(session.secure?.sessionId)
  })
})
