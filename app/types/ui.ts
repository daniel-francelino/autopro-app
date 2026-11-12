import type { BadgeProps } from '@nuxt/ui'

/** Cores semanticas do Nuxt UI (UBadge/UButton/UAlert...). */
export type BadgeColor = NonNullable<BadgeProps['color']>

/** Alternancia de listagem entre tabela e cards. */
export type ViewMode = 'table' | 'card'
