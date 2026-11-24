import type { CustomViewSummary } from '#shared/types/customViews'

/** The caller's custom views, by name. */
export default defineUserHandler((_event, tx): Promise<CustomViewSummary[]> => loadCustomViews(tx))
