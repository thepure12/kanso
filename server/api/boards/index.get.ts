import type { BoardSummary } from '#shared/types/board'

export default defineUserHandler((_event, tx): Promise<BoardSummary[]> => loadBoardSummaries(tx))
