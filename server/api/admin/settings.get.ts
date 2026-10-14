export default defineUserHandler(async (_event, tx) => {
  const [row] = await tx.select(settingsColumns).from(schema.instanceSettings)
  return settingsOrForbidden(row)
})
