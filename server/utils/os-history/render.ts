import { createHash } from 'node:crypto'
import { OS_HISTORY_SOURCES, isOsHistorySourceCode } from '../../../lib/utils/os-history-sources'

/** Linha de service_order_events como lida do banco (só o que o renderizador usa). */
export interface OsEventRow {
  id: string
  occurred_at: string
  event_type: string
  schema_version: number
  category: string
  actor_name: string | null
  payload: Record<string, unknown> | null
  correlation_id: string
  source_code: string
  source_label: string
}

export interface RenderedOsEvent {
  id: string
  occurredAt: string
  category: string
  title: string
  description: string
  details: Array<{ label: string, from: string | null, to: string | null }>
  actorName: string | null
  source: { code: string, label: string }
  /** correlation_id opaco (não revela o request_id), para agrupar efeitos de uma mesma ação. */
  groupId: string
}

const PAYMENT_METHODS: Record<string, string> = {
  pix: 'Pix', cash: 'Dinheiro', credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito',
  check: 'Cheque', bank_slip: 'Boleto', boleto: 'Boleto', transfer: 'Transferência', bank_transfer: 'Transferência'
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Aberta', in_progress: 'Em andamento', completed: 'Concluída', cancelled: 'Cancelada',
  estimate: 'Orçamento', waiting_for_part: 'Aguardando peça', invoiced: 'Faturada', delivered: 'Entregue'
}

// F2: rótulos e formatos dos campos da OS (chaves de server/utils/os-history/diff.ts). Chave desconhecida => rótulo genérico.
const ORDER_FIELD_LABELS: Record<string, { label: string, kind: 'text' | 'money' | 'date' | 'bool' | 'opaque' | 'int' }> = {
  number: { label: 'Número da OS', kind: 'text' },
  reported_defect: { label: 'Defeito relatado', kind: 'text' },
  diagnosis: { label: 'Diagnóstico', kind: 'text' },
  notes: { label: 'Observações', kind: 'text' },
  entry_date: { label: 'Data de entrada', kind: 'date' },
  expected_date: { label: 'Previsão de entrega', kind: 'date' },
  expected_payment_date: { label: 'Previsão de pagamento', kind: 'date' },
  completion_date: { label: 'Data de conclusão', kind: 'date' },
  discount: { label: 'Desconto', kind: 'money' },
  total_amount: { label: 'Valor total', kind: 'money' },
  total_taxes_amount: { label: 'Total de impostos', kind: 'money' },
  apply_taxes: { label: 'Aplicar impostos', kind: 'bool' },
  selected_taxes: { label: 'Impostos selecionados', kind: 'opaque' },
  total_cost_amount: { label: 'Custo total', kind: 'money' },
  terminal_fee_amount: { label: 'Taxa da maquininha', kind: 'money' },
  payment_method: { label: 'Forma de pagamento', kind: 'text' },
  payment_status: { label: 'Situação do pagamento', kind: 'text' },
  is_installment: { label: 'Pagamento parcelado', kind: 'bool' },
  installment_count: { label: 'Número de parcelas', kind: 'int' },
  client: { label: 'Cliente', kind: 'text' },
  vehicle: { label: 'Veículo', kind: 'text' },
  employee_responsible: { label: 'Funcionário responsável', kind: 'text' },
  master_product: { label: 'Produto principal', kind: 'text' }
}

export function formatBRL(value: unknown): string {
  // Nulo/vazio/não numérico: valor desconhecido, nunca "R$ 0,00".
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n).replace(/ /g, ' ')
}

function formatDate(value: unknown): string | null {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null
}

const lookup = (map: Record<string, string>, key: string) => (Object.hasOwn(map, key) ? map[key] : undefined)

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

type Rendered = Pick<RenderedOsEvent, 'title' | 'description' | 'details'>

const PAYMENT_STATUS_LABELS: Record<string, string> = { pending: 'Pendente', partial: 'Parcialmente pago', paid: 'Pago' }

const COMMISSION_REMOVED_REASONS: Record<string, string> = {
  recalculated: 'recalculada após mudança nos recebimentos',
  order_cancelled: 'OS cancelada',
  payment_deleted: 'pagamento da OS removido',
  manual_delete: 'exclusão manual'
}

const ENTRY_FIELD_LABELS: Record<string, string> = {
  amount: 'Valor', due_date: 'Vencimento', status: 'Situação', bank_account: 'Conta', description: 'Descrição'
}

const ENTRY_STATUS_LABELS: Record<string, string> = { pending: 'Pendente', paid: 'Pago', cancelled: 'Cancelado', overdue: 'Vencido' }

const withDot = (text: string) => (text.endsWith('.') ? text : `${text}.`)
const noun = (name: unknown, fallback = 'funcionário') => str(name) ?? fallback

function entryChanges(p: Record<string, unknown>): Array<{ label: string, from: string | null, to: string | null }> {
  const list = Array.isArray(p.changes) ? p.changes as Array<Record<string, unknown>> : []
  return list.flatMap((c) => {
    const field = String(c.field ?? '')
    const label = lookup(ENTRY_FIELD_LABELS, field)
    if (!label) return []
    const fmt = (v: unknown) => {
      if (v == null || v === '') return '-'
      if (field === 'amount') return formatBRL(v)
      if (field === 'due_date') return formatDate(v) ?? '-'
      if (field === 'status') return lookup(ENTRY_STATUS_LABELS, String(v)) ?? str(v) ?? '-'
      return str(v) ?? '-'
    }
    return [{ label, from: fmt(c.from), to: fmt(c.to) }]
  })
}

function receivedText(p: Record<string, unknown>, verb: string, actor: string) {
  const method = str(p.payment_method)
  const date = formatDate(p.payment_date)
  const account = str(p.bank_account_name)
  let text = `${verb}: ${formatBRL(p.amount)}`
  if (method) text += ` (${lookup(PAYMENT_METHODS, method) ?? method})`
  if (date) text += ` em ${date}`
  if (account) text += `, conta ${account}`
  return `${text}. Registrado por ${actor}.`
}

// Eventos da fatia F1 (pagamentos e comissões). Os textos nunca citam ids; valores vêm do snapshot do payload.
const F1_RENDERERS: Record<string, (p: Record<string, unknown>, actor: string) => Rendered> = {
  'order.cancelled': (p, actor) => ({
    title: 'OS cancelada',
    description: `${p.order_number ? `OS nº ${String(p.order_number)} cancelada` : 'OS cancelada'} por ${actor}.`,
    details: []
  }),
  'installment.removed': (p, actor) => {
    const n = p.installment_number != null ? ` ${String(p.installment_number)}` : ''
    const reason = str(p.reason)
    return {
      title: `Parcela${n} removida`,
      description: `Parcela${n} (${formatBRL(p.amount)}) removida por ${actor}.${reason ? ` Motivo: ${reason}.` : ''}`,
      details: []
    }
  },
  'installment.edited': (p, actor) => {
    const n = p.installment_number != null ? ` ${String(p.installment_number)}` : ''
    return {
      title: `Parcela${n} alterada`,
      description: `Parcela${n} alterada por ${actor}.`,
      details: entryChanges(p)
    }
  },
  'payment.plan_created': (p, actor) => {
    const count = Number(p.installment_count)
    const parcels = Number.isFinite(count) && count > 0 ? `${count} ${count === 1 ? 'parcela' : 'parcelas'}, ` : ''
    const again = p.after_removal === true ? ' novamente' : ''
    return {
      title: p.after_removal === true ? 'Plano de pagamento gerado novamente' : 'Plano de pagamento criado',
      description: `Plano de pagamento gerado${again} por ${actor}: ${parcels}total a receber ${formatBRL(p.total_amount)}.`,
      details: []
    }
  },
  'payment.deleted': (p, actor) => {
    const received = Number(p.received_total)
    const undone = Number.isFinite(received) && received > 0 ? ` Recebimentos desfeitos: ${formatBRL(received)}.` : ''
    return {
      title: 'Pagamento da OS removido',
      description: `Pagamento da OS removido por ${actor}: plano de pagamento apagado.${undone}`,
      details: []
    }
  },
  'payment.down_payment_received': (p, actor) => ({
    title: 'Sinal recebido', description: receivedText(p, 'Sinal recebido', actor), details: []
  }),
  'payment.extra_received': (p, actor) => ({
    title: 'Recebimento adicional', description: receivedText(p, 'Recebimento adicional', actor), details: []
  }),
  'payment.status_changed': (p) => {
    const label = (v: unknown) => lookup(PAYMENT_STATUS_LABELS, String(v)) ?? str(v) ?? '-'
    return {
      title: 'Situação do pagamento alterada',
      description: `Situação do pagamento alterada de '${label(p.from)}' para '${label(p.to)}'.`,
      details: [{ label: 'Situação do pagamento', from: label(p.from), to: label(p.to) }]
    }
  },
  'receipt.reversed': (p, actor) => {
    const n = p.installment_number != null ? ` da parcela ${String(p.installment_number)}` : ''
    const reason = str(p.reason)
    return {
      title: 'Recebimento desfeito',
      description: `Recebimento${n} de ${formatBRL(p.amount)} desfeito por ${actor}.${reason ? ` Motivo: ${reason}.` : ''}`,
      details: []
    }
  },
  'entry.paid_outside_os': (p, actor) => ({
    title: 'Lançamento marcado como pago',
    description: `Lançamento vinculado à OS (${formatBRL(p.amount)}) marcado como pago por ${actor}, fora da tela da OS.`,
    details: []
  }),
  'entry.edited': (p, actor) => ({
    title: 'Lançamento alterado',
    description: `${actor} alterou o lançamento vinculado à OS fora da tela da OS.`,
    details: entryChanges(p)
  }),
  'commission.released': (p) => {
    const rule = str(p.rule_name)
    const mode = p.release_mode === 'full' ? 'liberada integralmente, sem esperar o recebimento' : 'liberada proporcionalmente ao recebido'
    return {
      title: 'Comissão liberada',
      description: `Comissão de ${formatBRL(p.amount)} ${mode} para ${noun(p.employee_name)}${rule ? ` (regra: ${rule})` : ''}.`,
      details: []
    }
  },
  'commission.recalculated': (p, actor) => {
    const reason = str(p.reason)
    const override = p.override_action === 'apply'
      ? ` Configuração manual aplicada${str(p.override_plan_name) ? `: ${str(p.override_plan_name)}` : ''}.`
      : p.override_action === 'remove' ? ' Configuração manual removida.' : ''
    return {
      title: 'Comissão recalculada',
      description: `Comissão de ${noun(p.employee_name)} recalculada por ${actor}: de ${formatBRL(p.previous_amount)} para ${formatBRL(p.new_amount)}.${override}${reason ? ` Motivo: ${reason}.` : ''}`,
      details: [{ label: 'Comissão', from: formatBRL(p.previous_amount), to: formatBRL(p.new_amount) }]
    }
  },
  'commission.regenerated': (p, actor) => ({
    title: 'Comissões regeneradas',
    description: `Comissões da OS regeneradas por ${actor}: total de comissões (pagas e a pagar) de ${formatBRL(p.total_before)} para ${formatBRL(p.total_after)}.`,
    details: [{ label: 'Total de comissões', from: formatBRL(p.total_before), to: formatBRL(p.total_after) }]
  }),
  'commission.release_mode_changed': (_p, actor) => ({
    title: 'Liberação de comissões alterada',
    description: `Comissões da OS passaram a ser liberadas integralmente, sem esperar o recebimento (definido por ${actor}).`,
    details: []
  }),
  'commission.removed': (p, actor) => {
    const reason = lookup(COMMISSION_REMOVED_REASONS, String(p.reason ?? ''))
    const paid = p.was_paid === true ? ' (já estava paga)' : ''
    return {
      title: 'Comissão removida',
      description: `Comissão de ${formatBRL(p.amount)} de ${noun(p.employee_name)} removida${paid}${reason ? `: ${reason}` : ''}. Ação de ${actor}.`,
      details: []
    }
  },
  'commission.paid': (p, actor) => {
    const date = formatDate(p.payment_date)
    const account = str(p.bank_account_name)
    let text = `Comissão de ${formatBRL(p.amount)} paga a ${noun(p.employee_name)}`
    if (date) text += ` em ${date}`
    if (account) text += ` (conta ${account})`
    text += `, por ${actor}.`
    if (p.via_entry === true) text = `Lançamento da comissão de ${noun(p.employee_name)} (${formatBRL(p.amount)}) marcado como pago por ${actor}.${p.record_synced === false ? ' O registro da comissão não foi atualizado.' : ''}`
    if (p.without_receipt === true) text += ' A OS ainda não tinha recebimento registrado.'
    return { title: 'Comissão paga', description: text, details: [] }
  },
  'commission.entry_edited': (p, actor) => ({
    title: 'Lançamento da comissão alterado',
    description: `${actor} alterou o lançamento financeiro da comissão de ${noun(p.employee_name)}.`,
    details: entryChanges(p)
  }),
  'commission.entry_deleted': (p, actor) => {
    const reason = str(p.reason)
    return {
      title: 'Lançamento da comissão excluído',
      description: withDot(`${actor} excluiu o lançamento financeiro da comissão de ${noun(p.employee_name)} (${formatBRL(p.amount)})${reason ? `. Motivo: ${reason}` : ''}`),
      details: []
    }
  }
}

const fieldValue = (kind: string, v: unknown): string => {
  if (v == null || v === '') return '(vazio)'
  if (kind === 'money') return formatBRL(v)
  if (kind === 'date') return formatDate(v) ?? '(vazio)'
  if (kind === 'bool') return v === true ? 'Sim' : 'Não'
  return str(v) ?? (typeof v === 'number' ? String(v) : '(vazio)')
}

const paymentTermValue = (field: string, v: unknown, kind: string): string => {
  if (field === 'payment_method') return v == null || v === '' ? '(vazio)' : (lookup(PAYMENT_METHODS, String(v)) ?? 'outra forma')
  if (field === 'payment_status') return v == null || v === '' ? '(vazio)' : (lookup(PAYMENT_STATUS_LABELS, String(v)) ?? 'outra situação')
  if (kind === 'money' || kind === 'int') return fieldValue(kind === 'int' ? 'text' : kind, v ?? 0)
  return fieldValue(kind, v)
}

const qtyText = (v: unknown) => (v == null ? '-' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(v)))
const ITEM_FIELD_LABELS: Record<string, string> = { name: 'Nome', quantity: 'Quantidade', unit_price: 'Preço', discount: 'Desconto' }

function itemFieldValue(field: string, v: unknown): string {
  if (field === 'quantity') return qtyText(v)
  if (field === 'name') return str(v) ?? '(sem nome)'
  return v == null ? formatBRL(0) : formatBRL(v)
}

function itemSummary(l: Record<string, unknown>): string {
  const disc = Number(l.discount)
  return `${qtyText(l.quantity)} x ${formatBRL(l.unit_price)}${Number.isFinite(disc) && disc > 0 ? ` (desconto ${formatBRL(disc)})` : ''}`
}

const APPOINTMENT_STATUS_LABELS: Record<string, string> = { scheduled: 'Agendado', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado' }

const whenText = (p: Record<string, unknown>) => {
  const date = formatDate(p.date); const time = str(p.time)
  return date ? `${date}${time ? ` às ${time}` : ''}` : (time ? `às ${time}` : 'data não informada')
}

// F3: agendamento vinculado à OS. Data e hora vêm do snapshot (sem fuso: são os valores digitados na Agenda).
const APPOINTMENT_RENDERERS: Record<string, (p: Record<string, unknown>, actor: string) => Rendered> = {
  'appointment.created': (p, actor) => ({ title: 'Agendamento criado', description: `Agendamento criado para ${whenText(p)} por ${actor}.`, details: [] }),
  'appointment.linked': (p, actor) => ({
    title: p.created === true ? 'Agendamento criado' : 'Agendamento vinculado',
    description: `${p.created === true ? 'Agendamento criado e vinculado à OS' : 'Agendamento vinculado à OS'} para ${whenText(p)} por ${actor}.`,
    details: []
  }),
  'appointment.unlinked': (p, actor) => ({ title: 'Agendamento desvinculado', description: `Agendamento de ${whenText(p)} desvinculado da OS por ${actor}.`, details: [] }),
  'appointment.cancelled': (p, actor) => ({ title: 'Agendamento cancelado', description: `Agendamento de ${whenText(p)} cancelado por ${actor}.`, details: [] }),
  'appointment.removed': (p, actor) => ({ title: 'Agendamento excluído', description: `Agendamento de ${whenText(p)} excluído da Agenda por ${actor}.`, details: [] }),
  'appointment.changed': (p, actor) => {
    const list = Array.isArray(p.changes) ? p.changes as Array<Record<string, unknown>> : []
    const labels: Record<string, string> = { date: 'Data', time: 'Hora', status: 'Situação', service_type: 'Tipo de serviço' }
    const fmt = (field: string, v: unknown) => {
      if (field === 'date') return formatDate(v) ?? '-'
      if (field === 'status') return lookup(APPOINTMENT_STATUS_LABELS, String(v)) ?? (str(v) ? 'outra situação' : '-')
      return str(v) ?? '-'
    }
    const details = list.map((c) => { const f = String(c.field ?? ''); return { label: lookup(labels, f) ?? 'Outro campo', from: fmt(f, c.from), to: fmt(f, c.to) } })
    return {
      title: 'Agendamento alterado',
      description: `Agendamento da OS alterado por ${actor}${details.length ? `: ${details.map(d => `${d.label.toLowerCase()} ${d.from} → ${d.to}`).join('; ')}` : ''}.`,
      details
    }
  }
}

const F2_RENDERERS: Record<string, (p: Record<string, unknown>, actor: string) => Rendered> = {
  'order.created': (p, actor) => ({
    title: 'OS criada',
    description: `${p.order_number ? `OS nº ${String(p.order_number)} criada` : 'OS criada'} por ${actor}.`,
    details: []
  }),
  'order.deleted': (p, actor) => {
    const r = (p.removed && typeof p.removed === 'object' ? p.removed : {}) as Record<string, unknown>
    const n = (k: string) => { const v = Number(r[k]); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0 }
    const plural = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`
    const parts = [
      ...(n('installments') ? [plural(n('installments'), 'parcela', 'parcelas')] : []),
      ...(n('receipts') ? [plural(n('receipts'), 'recebimento estornado', 'recebimentos estornados')] : []),
      ...(n('commissions') ? [plural(n('commissions'), 'comissão', 'comissões')] : [])
    ]
    return {
      title: 'OS excluída',
      description: `${p.order_number ? `OS nº ${String(p.order_number)} excluída` : 'OS excluída'} por ${actor}.${parts.length ? ` Removidos junto: ${parts.join(', ')}.` : ''}`,
      details: []
    }
  },
  ...APPOINTMENT_RENDERERS,
  'order.fields_changed': (p, actor) => {
    const list = Array.isArray(p.changes) ? p.changes as Array<Record<string, unknown>> : []
    const details = list.map((c) => {
      const key = String(c.field ?? '')
      const def = Object.hasOwn(ORDER_FIELD_LABELS, key) ? ORDER_FIELD_LABELS[key] : undefined
      const kind = def?.kind ?? 'text'
      return { label: def?.label ?? 'Outro campo', from: fieldValue(kind, c.from), to: fieldValue(kind, c.to) }
    })
    return { title: 'OS alterada', description: `${actor} alterou: ${details.map(d => d.label).join(', ') || 'dados da OS'}.`, details }
  },
  'order.payment_terms_changed': (p, actor) => {
    const list = Array.isArray(p.changes) ? p.changes as Array<Record<string, unknown>> : []
    const details = list.map((c) => {
      const key = String(c.field ?? '')
      const def = Object.hasOwn(ORDER_FIELD_LABELS, key) ? ORDER_FIELD_LABELS[key] : undefined
      const kind = def?.kind ?? 'text'
      return { label: def?.label ?? 'Condição de pagamento', from: paymentTermValue(key, c.from, kind), to: paymentTermValue(key, c.to, kind) }
    })
    return { title: 'Condições de pagamento da OS alteradas', description: `${actor} alterou: ${details.map(d => d.label).join(', ') || 'condições de pagamento'}.`, details }
  },
  'order.items_changed': (p, actor) => {
    const lines = Array.isArray(p.lines) ? p.lines as Array<Record<string, unknown>> : []
    const details: Rendered['details'] = lines.map((l) => {
      const name = str(l.name) ?? '(sem nome)'
      if (l.action === 'added') return { label: `Item adicionado: ${name}`, from: null, to: itemSummary(l) }
      if (l.action === 'removed') return { label: `Item removido: ${name}`, from: itemSummary(l), to: null }
      const ch = Array.isArray(l.changes) ? l.changes as Array<Record<string, unknown>> : []
      const part = (side: 'from' | 'to') => ch.map(c => `${lookup(ITEM_FIELD_LABELS, String(c.field)) ?? 'Campo'} ${itemFieldValue(String(c.field), c[side])}`).join('; ')
      return { label: `Item alterado: ${name}`, from: part('from'), to: part('to') }
    })
    const more = Number(p.more)
    if (Number.isFinite(more) && more > 0) details.push({ label: `e mais ${more} ${more === 1 ? 'item' : 'itens'}`, from: null, to: null })
    return { title: 'Itens da OS alterados', description: `${actor} alterou os itens da OS.`, details }
  },
  'order.responsibles_changed': (p, actor) => {
    const names = (v: unknown) => (Array.isArray(v) ? v.map(n => str(n) ?? '(sem nome)') : [])
    const added = names(p.added); const removed = names(p.removed)
    const parts = [
      ...(added.length ? [`adicionado${added.length > 1 ? 's' : ''}: ${added.join(', ')}`] : []),
      ...(removed.length ? [`removido${removed.length > 1 ? 's' : ''}: ${removed.join(', ')}`] : [])
    ]
    return {
      title: 'Responsáveis alterados',
      description: `Responsáveis da OS alterados por ${actor} (${parts.join('; ')}).`,
      details: [{ label: 'Responsáveis', from: removed.join(', ') || null, to: added.join(', ') || null }]
    }
  }
}

// Templates por event_type; o `schema_version` permite evoluir o payload sem reescrever o histórico.
const RENDERERS: Record<string, (p: Record<string, unknown>, actor: string) => Rendered> = {
  'installment.paid': (p, actor) => {
    const number = p.installment_number != null ? String(p.installment_number) : null
    const method = str(p.payment_method)
    const date = formatDate(p.payment_date)
    const partial = p.partial === true
    const noun = number ? `Parcela ${number}` : 'Parcela'
    const title = `${noun} ${partial ? 'recebida parcialmente' : 'recebida'}`
    let text = `${title}: ${formatBRL(p.amount)}`
    if (method) text += ` (${lookup(PAYMENT_METHODS, method) ?? method})`
    if (date) text += ` em ${date}`
    return { title, description: `${text}. Registrado por ${actor}.`, details: [] }
  },
  ...F1_RENDERERS,
  ...F2_RENDERERS,
  'order.status_changed': (p, actor) => {
    // Código fora do mapa não é exposto ao cliente (continua no payload).
    const label = (v: unknown) => lookup(STATUS_LABELS, String(v)) ?? (str(v) ? 'outro status' : '-')
    return {
      title: 'Status alterado',
      description: `Status alterado de '${label(p.from)}' para '${label(p.to)}' por ${actor}.`,
      details: [{ label: 'Status', from: label(p.from), to: label(p.to) }]
    }
  }
}

export function renderOsEvent(row: OsEventRow): RenderedOsEvent {
  const actor = row.actor_name?.trim() || 'usuário'
  const payload = row.payload ?? {}
  const render = RENDERERS[row.event_type]
  const body: Rendered = render
    ? render(payload, actor)
    : { title: 'Evento registrado', description: `Evento registrado por ${actor}.`, details: [] }
  const code = isOsHistorySourceCode(row.source_code) ? row.source_code : 'unknown'
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    category: row.category,
    ...body,
    actorName: row.actor_name,
    source: { code, label: OS_HISTORY_SOURCES[code] },
    groupId: createHash('sha256').update(row.correlation_id).digest('hex').slice(0, 16)
  }
}
