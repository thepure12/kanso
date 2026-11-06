export default defineOAuthDiscordEventHandler({
  config: { emailRequired: true, redirectURL: oauthRedirectURL('discord') },
  async onSuccess(event, { user }) {
    const u = await upsertOAuthUser({
      provider: 'discord',
      providerUserId: user.id,
      email: user.email,
      emailVerified: user.verified === true,
      name: user.global_name || user.username,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
    })
    const { twoFactor } = await startSession(event, u)
    return sendRedirect(event, appPath(twoFactor ? '/login/2fa' : '/'))
  },
  onError: oauthError,
})
