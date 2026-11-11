// Os utilitários de servidor usam auto-imports do Nitro (createError etc.).
import { createError } from './h3-stub'

;

(globalThis as Record<string, unknown>).createError = createError
