import type { AvatarProps } from '@nuxt/ui'

/** Avatar of a person in pickers and lists; a bot without a picture shows a robot. */
export function personAvatar(p: { name: string, avatarUrl: string | null, isBot?: boolean }): AvatarProps {
  return { src: p.avatarUrl ?? undefined, alt: p.name, ...(p.isBot && !p.avatarUrl ? { icon: 'i-lucide-bot' } : {}) }
}

/**
 * Avatar and, for bots, a "Bot" description for a person in a select or dropdown
 * menu (assignee pickers, filters). `botLabel` is t('bots.badge').
 */
export function personItem(p: { name: string, avatarUrl: string | null, isBot?: boolean }, botLabel: string): { avatar: AvatarProps, description?: string } {
  return { avatar: personAvatar(p), ...(p.isBot ? { description: botLabel } : {}) }
}
