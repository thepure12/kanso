/** Whether this browser has a pending two-factor sign-in (for the /login/2fa page). */
export default defineEventHandler(async (event) => {
  const pending = (await getUserSession(event)).secure?.pendingTwoFactor
  return { pending: !!pending && pending.expiresAt > Date.now() }
})
