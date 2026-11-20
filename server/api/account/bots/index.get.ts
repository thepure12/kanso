import type { AccountBot } from '#shared/types/bots'

/** The caller's account bots with their tokens and boards (0109_account_bots_rls.sql). Cookie only. */
export default defineUserHandler(async (_event, tx): Promise<AccountBot[]> => loadAccountBots(tx))
