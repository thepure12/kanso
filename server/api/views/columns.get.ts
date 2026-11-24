import type { ViewColumn } from '#shared/types/customViews'

/** Columns the caller can put into a custom view. */
export default defineUserHandler((_event, tx): Promise<ViewColumn[]> => loadViewableColumns(tx))
