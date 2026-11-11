import type { Page } from '@playwright/test'

// Substitutos de `waitForTimeout`: esperam uma condição observável e só então seguem. O limite existe apenas
// para o caso de a condição nunca ocorrer (ex.: o botão estava desabilitado e nenhuma requisição saiu).

/** Espera a rede ficar ociosa (a lista terminou de buscar e renderizar). */
export async function settle(page: Page, timeout = 3000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {})
}

/** Executa a ação e espera a requisição de escrita que ela dispara (se houver), depois a rede ociosa. */
export async function settleAfter(page: Page, action: () => Promise<unknown>, timeout = 2000): Promise<void> {
  const write = page.waitForResponse(r => r.request().method() !== 'GET', { timeout }).catch(() => null)
  await action()
  await write
  await settle(page, timeout)
}
