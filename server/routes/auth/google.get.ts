export default defineOAuthGoogleEventHandler({
  config: { redirectURL: oauthRedirectURL('google') },
  async onSuccess(event, { user }) {
    const u = await upsertOAuthUser({
      provider: 'google',
      providerUserId: user.sub,
      email: user.email,
      emailVerified: user.email_verified === true,
      name: user.name || user.email,
      avatarUrl: user.picture ?? null,
    })
    const { twoFactor } = await startSession(event, u)
    return sendRedirect(event, appPath(twoFactor ? '/login/2fa' : '/'))
  },
  onError: oauthError,
})
