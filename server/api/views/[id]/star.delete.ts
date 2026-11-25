/** Unstars one of the caller's custom views. Idempotent. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  await setCustomViewStar(tx, id, false)
  return { starred: false }
})
