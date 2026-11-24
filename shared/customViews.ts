import { z } from 'zod'

export const CUSTOM_VIEW_MAX_COLUMNS = 50

export const customViewName = z.string().trim().min(1).max(100)
/** Column ids in view order, no repeats. */
export const customViewColumnIds = z.array(z.uuid()).max(CUSTOM_VIEW_MAX_COLUMNS)
  .refine(ids => new Set(ids).size === ids.length, 'Duplicate column')
