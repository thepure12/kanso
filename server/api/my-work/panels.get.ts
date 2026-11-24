import type { MyWorkPanel } from '#shared/types/myWork'

/** The caller's My work panels, in order. */
export default defineUserHandler(async (_event, tx): Promise<MyWorkPanel[]> => loadMyWorkPanels(tx))
