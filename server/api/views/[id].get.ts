import type { CustomView } from '#shared/types/customViews'

/** One of the caller's custom views with the columns they can see. */
export default defineUserHandler(async (event, tx): Promise<CustomView> => {
  const { id } = await paramsValidated(event, uuidParam)
  return (await loadCustomView(tx, id)) ?? notFound('View not found')
})
