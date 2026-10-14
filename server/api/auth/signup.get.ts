// Sign-up mode for the register page's hint.
export default defineEventHandler(async () => {
  const [row] = await useAuthDb().select({ mode: schema.instanceSettings.signupMode }).from(schema.instanceSettings)
  return { mode: row?.mode ?? 'restricted' }
})
