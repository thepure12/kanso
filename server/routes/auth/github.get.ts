export default defineOAuthGitHubEventHandler({
  config: { emailRequired: true },
  async onSuccess(event, { user }) {
    const u = await upsertOAuthUser({
      provider: 'github',
      providerUserId: String(user.id),
      email: user.email,
      // Public GitHub emails are verified; otherwise the handler sets email_verified from /user/emails.
      emailVerified: user.email_verified ?? true,
      name: user.name || user.login,
      avatarUrl: user.avatar_url ?? null,
    })
    const { twoFactor } = await startSession(event, u)
    return sendRedirect(event, twoFactor ? '/login/2fa' : '/')
  },
  onError: oauthError,
})
