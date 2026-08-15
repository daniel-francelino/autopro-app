/**
 * Normalizes text for accent/case-insensitive search matching.
 * "José" and "jose" both normalize to "jose".
 */
export function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}
