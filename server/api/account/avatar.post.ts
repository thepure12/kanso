import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'

const MAX_AVATAR_BYTES = 1024 * 1024

/**
 * multipart/form-data with one `file` part: sets it as the user's profile
 * picture. The client scales it down first; users.avatar_url then points at
 * GET /api/users/:id/avatar with a new token, so browsers fetch the new image.
 */
export default defineUserHandler(async (event, tx, userId): Promise<{ avatarUrl: string }> => {
  const length = Number(getHeader(event, 'content-length') ?? 0)
  if (length > MAX_AVATAR_BYTES + 64 * 1024) throw createError({ statusCode: 413, statusMessage: 'Image is larger than 1 MB' })

  const file = (await readMultipartFormData(event) ?? []).find(p => p.name === 'file' && p.filename)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'No file' })
  if (file.data.length > MAX_AVATAR_BYTES) throw createError({ statusCode: 413, statusMessage: 'Image is larger than 1 MB' })
  const contentType = imageType(file.data)
  if (!contentType) throw createError({ statusCode: 400, statusMessage: 'Use a PNG, JPEG, WebP or GIF image' })

  const { userAvatars: ua, users } = schema
  const image = { contentType, size: file.data.length, data: file.data, createdAt: new Date() }
  // RLS: only the user's own row.
  await tx.insert(ua).values({ userId, ...image }).onConflictDoUpdate({ target: ua.userId, set: image })
  const avatarUrl = appPath(`/api/users/${userId}/avatar?v=${randomBytes(6).toString('hex')}`)
  const [row] = await tx.update(users).set({ avatarUrl }).where(eq(users.id, userId)).returning({ id: users.id })
  if (!row) notFound('Account not found')
  // The header shows the picture from the session cookie.
  const session = await getUserSession(event)
  await setUserSession(event, { user: { ...session.user!, avatarUrl: avatarUrl } })
  return { avatarUrl }
})
