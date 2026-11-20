import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { AccountBot, BoardBot } from '#shared/types/bots'

const MAX_AVATAR_BYTES = 1024 * 1024

/**
 * multipart/form-data with one `file` part: sets the bot's profile picture
 * (app.set_bot_avatar: owners of its board or team, an account bot's owner). Like POST /api/account/avatar,
 * the client crops and scales it first. Cookie only.
 */
export default defineUserHandler(async (event, tx): Promise<BoardBot | AccountBot> => {
  const { id } = await paramsValidated(event, uuidParam)
  const scope = await botScope(tx, id)
  const length = Number(getHeader(event, 'content-length') ?? 0)
  if (length > MAX_AVATAR_BYTES + 64 * 1024) throw createError({ statusCode: 413, statusMessage: 'Image is larger than 1 MB' })

  const file = (await readMultipartFormData(event) ?? []).find(p => p.name === 'file' && p.filename)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'No file' })
  if (file.data.length > MAX_AVATAR_BYTES) throw createError({ statusCode: 413, statusMessage: 'Image is larger than 1 MB' })
  const contentType = imageType(file.data)
  if (!contentType) throw createError({ statusCode: 400, statusMessage: 'Use a PNG, JPEG, WebP or GIF image' })

  const avatarUrl = appPath(`/api/users/${id}/avatar?v=${randomBytes(6).toString('hex')}`)
  await tx.execute(sql`select app.set_bot_avatar(${id}, ${contentType}, ${file.data}::bytea, ${avatarUrl})`)
  return loadManagedBot(tx, scope, id)
})
