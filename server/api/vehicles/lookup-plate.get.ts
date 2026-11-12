import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

// Plate lookup using wdapi2.com.br (or configurable env var)
// Set WDAPI_TOKEN in your .env to enable plate lookup
// Optionally override the endpoint with PLATE_API_URL (must accept /{plate}/{token})

interface WdapiResponse {
  MARCA?: string
  MODELO?: string
  SUBMODELO?: string
  ano?: string
  anoModelo?: string
  cor?: string
  MOTORIZACAO?: string
  COMBUSTIVEL?: string
  [key: string]: unknown
}

const FUEL_MAP: Record<string, string> = {
  'GASOLINA': 'gasoline',
  'GASOLINA/ALCOOL': 'flex',
  'GASOLINA/ÁLCOOL': 'flex',
  'ALCOOL': 'ethanol',
  'ÁLCOOL': 'ethanol',
  'ETANOL': 'ethanol',
  'FLEX': 'flex',
  'DIESEL': 'diesel',
  'GNV': 'cng',
  'GAS': 'cng',
  'ELETRICO': 'electric',
  'ELÉTRICO': 'electric',
  'HIBRIDO': 'hybrid',
  'HÍBRIDO': 'hybrid'
}

function mapFuel(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  return FUEL_MAP[raw.trim().toUpperCase()] ?? undefined
}

export default defineEventHandler(async (event) => {
  // Consome a cota paga da API de placas: exige login e oficina (antes era público).
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'vehicles.read', event)
  await resolveOrganizationId(event, authUser.id)

  const { plate } = getQuery(event) as { plate?: string }

  if (!plate || plate.replace(/[^A-Z0-9]/gi, '').length < 7) {
    throw createError({ statusCode: 400, statusMessage: 'Placa inválida' })
  }

  const clean = plate.replace(/[^A-Z0-9]/gi, '').toUpperCase()

  const token = process.env.WDAPI_TOKEN
  if (!token) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Consulta de placa não configurada. Defina WDAPI_TOKEN no arquivo .env.'
    })
  }

  const baseUrl = (process.env.PLATE_API_URL ?? 'https://wdapi2.com.br/consulta').replace(/\/$/, '')
  const url = `${baseUrl}/${clean}/${token}`

  const raw = await $fetch<WdapiResponse>(url).catch((err: unknown) => {
    const status = (err as { status?: number })?.status
    if (status === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Placa não encontrada' })
    }
    throw createError({ statusCode: 502, statusMessage: 'Erro ao consultar o serviço de placas' })
  })

  const year = raw.ano ? Number(raw.ano) : raw.anoModelo ? Number(raw.anoModelo) : undefined

  return {
    brand: raw.MARCA?.trim() || undefined,
    model: raw.MODELO?.trim() || raw.SUBMODELO?.trim() || undefined,
    year: year && !Number.isNaN(year) ? year : undefined,
    fuel_type: mapFuel(raw.COMBUSTIVEL),
    color: raw.cor?.trim() || undefined,
    engine: raw.MOTORIZACAO?.trim() || undefined
  }
})
