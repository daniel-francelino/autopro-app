/** Código curto (8 primeiros caracteres do X-Request-Id) para o usuário informar ao suporte. */
export function apiErrorCode(error: unknown): string | null {
  const headers = (error as { response?: { headers?: { get?: (name: string) => string | null } } })?.response?.headers
  const id = headers?.get?.('x-request-id')
  return id ? id.slice(0, 8) : null
}

function apiErrorMessage(error: unknown, fallback: string): string {
  const err = error as { data?: { statusMessage?: string, message?: string }, statusMessage?: string, message?: string }
  return err?.data?.statusMessage || err?.data?.message || err?.statusMessage || fallback
}

/**
 * Toast de erro de API com o código da requisição e botão "Copiar código".
 * O suporte localiza a requisição em /admin/audit pelo código (filtro "Código do erro").
 */
export function useApiErrorToast() {
  const toast = useToast()

  return (error: unknown, title = 'Não foi possível concluir a ação', fallbackMessage = 'Tente novamente em instantes.') => {
    const code = apiErrorCode(error)
    const message = apiErrorMessage(error, fallbackMessage)
    toast.add({
      title,
      description: code ? `${message} (código ${code})` : message,
      color: 'error',
      actions: code
        ? [{
            label: 'Copiar código',
            color: 'neutral',
            variant: 'outline',
            onClick: () => {
              void navigator.clipboard?.writeText(code)
            }
          }]
        : undefined
    })
  }
}
