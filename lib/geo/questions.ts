// Bateria fixa de 20 perguntas (docs/seo/geo-audit-brasil.md §10.4). NÃO trocar: perde a comparação semanal.

export const GEO_ENGINES = ['chatgpt', 'gemini', 'google_ai_mode', 'claude', 'perplexity', 'copilot', 'meta_ai'] as const
export type GeoEngine = (typeof GEO_ENGINES)[number]

export const GEO_ENGINE_LABEL: Record<GeoEngine, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  google_ai_mode: 'Google (Modo IA / Visão Geral)',
  claude: 'Claude',
  perplexity: 'Perplexity',
  copilot: 'Copilot',
  meta_ai: 'Meta AI'
}

export const GEO_QUESTIONS: ReadonlyArray<{ id: number, group: string, text: string }> = [
  { id: 1, group: 'Descoberta', text: 'Qual o melhor sistema para gerenciar uma oficina mecânica?' },
  { id: 2, group: 'Descoberta', text: 'Que software de ordem de serviço eu uso numa oficina pequena?' },
  { id: 3, group: 'Descoberta', text: 'Sistema para oficina mecânica com preço fixo mensal' },
  { id: 4, group: 'Descoberta', text: 'Programa para oficina mecânica que funcione no celular' },
  { id: 5, group: 'Descoberta', text: 'Quais sistemas de gestão para oficina mecânica existem no Brasil?' },
  { id: 6, group: 'Fiscal', text: 'Qual sistema de oficina emite NFS-e?' },
  { id: 7, group: 'Fiscal', text: 'Oficina mecânica precisa emitir nota fiscal de serviço? Como emitir?' },
  { id: 8, group: 'Fiscal', text: 'Sistema para oficina com emissão de nota fiscal integrada' },
  { id: 9, group: 'Fiscal', text: 'Como a oficina emite nota de serviço e de peças na mesma venda?' },
  { id: 10, group: 'Comissão e financeiro', text: 'Como calcular comissão de mecânico?' },
  { id: 11, group: 'Comissão e financeiro', text: 'Sistema que controla comissão por funcionário em oficina' },
  { id: 12, group: 'Comissão e financeiro', text: 'Como fazer o controle financeiro de uma oficina mecânica?' },
  { id: 13, group: 'Comissão e financeiro', text: 'Como controlar contas a receber parceladas na oficina?' },
  { id: 14, group: 'Estoque e operação', text: 'Como controlar estoque de peças em oficina?' },
  { id: 15, group: 'Estoque e operação', text: 'Modelo de ordem de serviço para oficina mecânica' },
  { id: 16, group: 'Estoque e operação', text: 'Como organizar a agenda de serviços da oficina?' },
  { id: 17, group: 'Comparação e preço', text: 'Quanto custa um sistema para oficina mecânica?' },
  { id: 18, group: 'Comparação e preço', text: 'Vale a pena trocar a planilha por um sistema de oficina?' },
  { id: 19, group: 'Marca (exatidão)', text: 'O que é o AutoPro, sistema para oficina mecânica?' },
  { id: 20, group: 'Marca (exatidão)', text: 'Quanto custa o AutoPro para oficinas e o que cada plano inclui?' }
]

export function geoQuestionText(id: number): string | null {
  return GEO_QUESTIONS.find(q => q.id === id)?.text ?? null
}
