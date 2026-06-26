/**
 * Resolves a Nuxt UI semantic color name (primary/secondary/success/info/
 * warning/error/neutral) to its actual CSS color value, read from the
 * --ui-{name} custom property Nuxt UI sets on the root element. Used where a
 * chart library needs a real color string, not a Tailwind/Nuxt UI token —
 * see docs/financial-categories-crud.md, section 3.5 (financial_categories
 * stores the token name, not a hex, to stay theme-aware).
 */
export function resolveUiColor(colorName: string, fallback = '#94a3b8'): string {
  if (!import.meta.client) return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--ui-${colorName}`).trim()
  return value || fallback
}
