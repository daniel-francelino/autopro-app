# Code review - modo de comissao como configuracao da organizacao (2026-11-14)

Veredito: APROVADO COM RESSALVAS (nenhum bloqueante).
Validacao: eslint nos 5 arquivos TS/Vue sem erros; vitest (service-orders, settings, static, os-history review-fixes, financial-payments): 10 arquivos, 254 passed, 0 falhas.

Verificado OK: org sempre da sessao (resolveOrganizationId); PUT exige settings.update e valida whitelist (400 pt-BR); auditoria before/after so quando muda; sync em process-payment apos todas as validacoes nos dois caminhos (balanceDue<=0 e normal; nada gravado antes, DI-10), update condicional (.neq + .eq organization_id), contagem por record_type='commission' (mesma chave do motor, service-order-commissions.ts:439); sem evento de historico (D4); motor nao le a org (so comentario); releaseCommissionsInFull ausente de server/ e app/ (so em testes que provam que e ignorado); migracao aditiva, NOT NULL DEFAULT 'full' + CHECK, sem DML, deve ser aplicada antes do deploy do app.

## Findings
- MEDIO - server/api/service-orders/[id]/process-payment.post.ts:~44-60: count + update nao sao atomicos; uma liberacao concorrente (outro request) entre eles pode deixar OS com comissao liberada mudar de modo. Janela estreita, risco baixo; mitigar so se houver concorrencia real (RPC/trigger) - aceitavel.
- BAIXO - server/api/organizations/index.put.ts:~58-80: previousMode lido antes do update sem condicao; dois PUTs concorrentes podem gerar auditoria "before" desatualizada. Cosmetico.
- BAIXO - server/api/organizations/index.put.ts:~50: se o body enviar null/nao-string em commission_release_mode retorna 400 (correto), mas vazio/undefined e ignorado silenciosamente - ok.
- BAIXO - app/components/service-orders/PaymentModal.vue:~(commissionModeLabel): se GET /api/organizations falha, exibe o modo armazenado na OS (pode divergir do que o servidor aplicara) e o rotulo pode aparecer antes de a org carregar (void loadOrgCommissionMode sem await). Rotulo e informativo; servidor e autoritativo. Sugestao: ocultar quando a org nao carregou e a OS nao tem comissao liberada.
- BAIXO - app/pages/app/settings/company.vue:104: fallback 'full' quando coluna ausente (migracao nao aplicada) mostra valor que nao existe; inofensivo se a migracao for aplicada antes do deploy.
- INFO - OS ja criadas mantem 'proportional' do default da migracao 74 ate o plano ser gerado sem comissao liberada; comportamento intencional (D5/secao 9.1) mas vale comunicar ao stakeholder, pois o default da org e 'full'.
- INFO - Fora do escopo/nao regressao: generate-commissions, receive-extra-payment e down-payment nao sincronizam (conforme decisao: so no plano).
