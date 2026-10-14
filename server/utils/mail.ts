import type { H3Event } from 'h3'
import { createTransport, type Transporter } from 'nodemailer'
import type { I18nContext } from '#shared/i18n'
import { formatDate } from '../../app/utils/format'

let transport: Transporter | undefined

interface Mail {
  to: string
  subject: string
  text: string
  html: string
}

/** Whether mail goes to SMTP (true) or only to the console log (false). */
function mailConfigured(): boolean {
  const config = useRuntimeConfig()
  if (config.mail.smtpUrl) return true
  if (!config.mail.logLinks) throw new Error('NUXT_MAIL_SMTP_URL is not configured')
  return false
}

async function sendMail(mail: Mail) {
  const config = useRuntimeConfig()
  transport ??= createTransport(config.mail.smtpUrl)
  await transport.sendMail({ from: config.mail.from, ...mail })
}

const DAY = 24 * 60 * 60_000
const HOUR = 60 * 60_000

/**
 * Mails a sign-up confirmation link for `user`. With NUXT_MAIL_LOG_LINKS (the
 * default in development) and no SMTP URL, the link is logged to the server
 * console instead.
 */
export async function sendVerificationEmail(event: H3Event, user: { id: string, email: string }) {
  const token = signEmailToken(user.id, user.email, useRuntimeConfig().session.password)
  await sendLink(event, user.id, user.email, `/auth/verify?token=${encodeURIComponent(token)}`, 'mail.verify', 'Confirmation')
}

/**
 * Mails a password reset link. The token carries the account's session
 * version, so it stops working once the password changes (it is single-use).
 */
export async function sendPasswordResetEmail(event: H3Event, user: { id: string, email: string, sessionVersion: number }) {
  const token = signEmailToken(user.id, user.email, useRuntimeConfig().session.password, HOUR, 'password-reset', user.sessionVersion)
  await sendLink(event, user.id, user.email, `/reset-password?token=${encodeURIComponent(token)}`, 'mail.reset', 'Password reset')
}

/** Mails a confirmation link to the new address of an email change. */
export async function sendEmailChangeEmail(event: H3Event, user: { id: string, sessionVersion: number }, newEmail: string) {
  const token = signEmailToken(user.id, newEmail, useRuntimeConfig().session.password, DAY, 'email-change', user.sessionVersion)
  await sendLink(event, user.id, newEmail, `/auth/confirm-email?token=${encodeURIComponent(token)}`, 'mail.emailChange', 'Email change')
}

/**
 * Mails a one-link message to `to` in the user's language (recipientLocale).
 * `keys` is the message group: subject, text ({link}), title, intro, button,
 * expiry and footer.
 */
async function sendLink(event: H3Event, userId: string, to: string, path: string, keys: string, label: string) {
  if (!mailConfigured()) {
    console.info(`[mail] ${label} link for ${to}: ${requestSiteUrl(event, true)}${path}`)
    return
  }
  const i18n = serverI18n(await recipientLocale(event, userId))
  const { t } = i18n
  const link = `${requestSiteUrl(event, false)}${path}`
  await sendMail({
    to,
    subject: t(`${keys}.subject`),
    text: t(`${keys}.text`, { link }),
    html: linkHtml(i18n, {
      title: t(`${keys}.title`),
      intro: t(`${keys}.intro`),
      button: t(`${keys}.button`),
      link,
      expiry: t(`${keys}.expiry`),
      footer: t(`${keys}.footer`),
    }),
  })
}

interface DigestCard {
  boardId: string
  boardName: string
  cardId: string
  cardTitle: string
}

/**
 * Daily digest of unread notifications (`text`, e.g. "Ann commented", already
 * in the recipient's language) and cards due soon. Called by the scheduled task.
 */
export async function sendDigestEmail(i18n: I18nContext, to: string, name: string, items: (DigestCard & { text: string })[], due: (DigestCard & { dueDate: string })[]) {
  const { t } = i18n
  const base = siteUrl()
  const cardLink = (i: DigestCard) => `${base}/boards/${i.boardId}?card=${i.cardId}`
  const dueText = (i: { dueDate: string }) => t('mail.digest.due', { date: formatDate(i.dueDate, i18n.locale) })
  const text = [
    t('mail.digest.greeting', { name }),
    ...(items.length ? ['', `${t('mail.digest.since')}:`, ...items.map(i => `- ${i.cardTitle} (${i.boardName}): ${i.text}\n  ${cardLink(i)}`)] : []),
    ...(due.length ? ['', `${t('mail.digest.dueSoon')}:`, ...due.map(i => `- ${i.cardTitle} (${i.boardName}): ${dueText(i)}\n  ${cardLink(i)}`)] : []),
    '', t('mail.digest.turnOffText', { url: `${base}/account` }),
  ].join('\n')

  if (!mailConfigured()) {
    console.info(`[mail] Digest for ${to}:\n${text}`)
    return
  }
  const list = <T extends DigestCard>(rows: T[], detail: (i: T) => string) => rows.map(i => `
      <tr><td style="padding:10px 0;border-top:1px solid #e4e4e7;font-size:14px;line-height:20px;">
        <a href="${escapeHtml(cardLink(i))}" style="color:#4f46e5;font-weight:600;text-decoration:none;">${escapeHtml(i.cardTitle)}</a>
        <span style="color:#71717a;"> · ${escapeHtml(i.boardName)}</span><br>
        <span style="color:#3f3f46;">${escapeHtml(detail(i))}</span>
      </td></tr>`).join('')
  const section = (title: string, rows: string) => rows
    ? `<h2 style="margin:24px 0 8px;font-size:15px;font-weight:600;color:#18181b;">${title}</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`
    : ''
  await sendMail({
    to,
    subject: t('mail.digest.subject'),
    text,
    html: layout(i18n.locale, t('mail.digest.subject'), `
      <h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600;color:#18181b;">${escapeHtml(t('mail.digest.heading', { name }))}</h1>
      ${section(escapeHtml(t('mail.digest.since')), list(items, i => i.text))}
      ${section(escapeHtml(t('mail.digest.dueSoon')), list(due, dueText))}`,
    `${escapeHtml(t('mail.digest.footer'))} <a href="${escapeHtml(base)}/account" style="color:#a1a1aa;">${escapeHtml(t('mail.digest.turnOff'))}</a>.`),
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}

/**
 * Mail page around `body`. Table layout and inline styles only, because mail
 * clients ignore most CSS; colours match the app (indigo/zinc).
 */
function layout(lang: string, title: string, body: string, footer: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
    <tr><td style="padding:0 8px 16px;font-size:20px;font-weight:700;color:#4f46e5;">Kanso</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:32px;">${body}
    </td></tr>
    <tr><td style="padding:16px 8px 0;font-size:12px;line-height:18px;color:#a1a1aa;">${footer}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`
}

/** A mail with one call-to-action link. */
function linkHtml(i18n: I18nContext, p: { title: string, intro: string, button: string, link: string, expiry: string, footer: string }): string {
  const href = escapeHtml(p.link)
  return layout(i18n.locale, p.title, `
      <h1 style="margin:0 0 12px;font-size:20px;line-height:28px;font-weight:600;color:#18181b;">${escapeHtml(p.title)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#3f3f46;">${escapeHtml(p.intro)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#4f46e5;">
        <a href="${href}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(p.button)}</a>
      </td></tr></table>
      <p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#71717a;">${escapeHtml(i18n.t('mail.linkExpiry', { expiry: p.expiry }))}</p>
      <p style="margin:4px 0 0;font-size:13px;line-height:20px;word-break:break-all;"><a href="${href}" style="color:#4f46e5;">${href}</a></p>`,
  escapeHtml(p.footer))
}

/**
 * Base URL for links in emails. Taken from NUXT_PUBLIC_SITE_URL so a forged
 * Host header cannot point a mailed link at another site. The request origin is
 * only a fallback for links that are logged, not mailed.
 */
function requestSiteUrl(event: H3Event, logged: boolean): string {
  const configured = useRuntimeConfig().public.siteUrl
  if (configured) return configured.replace(/\/+$/, '')
  if (!logged) throw new Error('NUXT_PUBLIC_SITE_URL is not configured')
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
}

/** Base URL without a request (scheduled task): NUXT_PUBLIC_SITE_URL, or localhost when only logging. */
function siteUrl(): string {
  const configured = useRuntimeConfig().public.siteUrl
  if (configured) return configured.replace(/\/+$/, '')
  if (mailConfigured()) throw new Error('NUXT_PUBLIC_SITE_URL is not configured')
  return 'http://localhost:3000'
}
