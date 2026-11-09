import { z } from 'zod'
import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { GEO_ENGINES, geoQuestionText } from '../../../../lib/geo/questions'
import { recordAudit } from '../../../utils/audit/record'

const text = z.string().trim().max(500)
const list = z.array(z.string().trim().min(1).max(500)).max(30)

const runSchema = z.object({
  run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  question_id: z.number().int().min(1).max(20),
  engine: z.enum(GEO_ENGINES),
  model_label: text.optional().nullable(),
  search_enabled: z.boolean(),
  brand_mentioned: z.boolean(),
  brand_linked: z.boolean(),
  recommended: z.boolean(),
  price_correct: z.boolean().nullable().optional(),
  fiscal_correct: z.boolean().nullable().optional(),
  competitors: list.optional(),
  cited_urls: list.optional(),
  evidence_url: text.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable()
})

const bodySchema = z.union([runSchema, z.array(runSchema).min(1).max(300)])

/**
 * POST /api/admin/geo/runs  — uma linha ou uma lista. Regrava a mesma (data, pergunta, motor, com/sem busca).
 * O texto da pergunta vem da bateria fixa: não é aceito do cliente (evita trocar as perguntas e perder a série).
 */
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const parsed = bodySchema.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Dados inválidos', data: parsed.error.flatten() })
  }

  const rows = (Array.isArray(parsed.data) ? parsed.data : [parsed.data]).map(row => ({
    ...row,
    question_text: geoQuestionText(row.question_id)!,
    price_correct: row.price_correct ?? null,
    fiscal_correct: row.fiscal_correct ?? null,
    competitors: row.competitors ?? [],
    cited_urls: row.cited_urls ?? [],
    created_by: owner.email
  }))

  const { error } = await getSupabaseAdminClient()
    .from('geo_probe_runs')
    .upsert(rows, { onConflict: 'run_date,question_id,engine,search_enabled' })

  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205'
    throw createError({
      statusCode: missing ? 503 : 500,
      statusMessage: missing ? 'Aplique a migration 20240101000103_create_geo_probe_runs.sql.' : 'Erro ao gravar a bateria'
    })
  }

  recordAudit(event, { resourceType: 'geo_probe_run', extra: { saved: rows.length, run_dates: [...new Set(rows.map(r => r.run_date))] } })
  return { success: true, saved: rows.length }
})
