import { z } from 'zod'
import { isDomain, normalizeDomain } from '#shared/signup'

const body = z.object({
  signupMode: z.enum(['open', 'restricted']),
  allowedDomains: z.array(z.string().max(253).transform(normalizeDomain).refine(isDomain, 'Invalid domain')).max(200),
  allowedEmails: z.array(z.email().max(254).transform(e => e.toLowerCase())).max(1000),
  allowExternalInvites: z.boolean(),
})

export default defineUserHandler(async (event, tx) => {
  const s = await readValidated(event, body)
  const [row] = await tx.update(schema.instanceSettings)
    .set({ ...s, allowedDomains: [...new Set(s.allowedDomains)], allowedEmails: [...new Set(s.allowedEmails)] })
    .returning(settingsColumns)
  return settingsOrForbidden(row)
})
