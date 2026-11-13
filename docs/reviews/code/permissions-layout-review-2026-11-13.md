# Code review: refatoração Configurações > Permissões (fases 1-8)

Data: 2026-11-13. Revisor independente. Escopo: arquivos do diff staged (HEAD vs index). Sem servidor, navegador ou E2E.

## Veredito: BLOQUEAR (1 bloqueante, corrigível em 2 linhas)

## Validação executada
- `pnpm vitest run --project fast tests/fast/lib/role- tests/fast/roles/role-counts`: 3 arquivos, 11 testes, todos passam.
- eslint nos arquivos alterados: sem saída (sem erros).
- `pnpm typecheck`: saída sem erros TS, mas o comando foi encadeado em `| tail`, então o exit code do vue-tsc ficou mascarado. Tratar como "sem erros visíveis". Importante: o typecheck NÃO detecta o bloqueante abaixo.

## Findings

### B1 (Bloqueante) Componentes novos não resolvem pelo nome usado nos templates
- Evidência: `.nuxt/components.d.ts:140-141` registra `RolesRolePermissionsAccordion` e `RolesRoleRowActions` (prefixo do diretório `components/roles/`; `nuxt.config.ts` não define `pathPrefix`). Os templates usam `<RolePermissionsAccordion>` (`app/pages/app/settings/roles/[id].vue:651`) e `<RoleRowActions>` (`app/pages/app/settings/roles/index.vue`, tabela e cards), sem import.
- Contraste: `index.vue` importa `RoleDetailsSlideover` explicitamente, exatamente por esse motivo.
- Impacto (inferido por regra do Nuxt/Vue, não executado): em runtime viram elementos desconhecidos com warning; o acordeão de permissões e todas as ações de linha (Editar/Ver/Excluir) não aparecem. Tela quebrada funcionalmente.
- Correção sugerida (para o Developer): importar explicitamente (`import RolePermissionsAccordion from '~/components/roles/RolePermissionsAccordion.vue'` em `[id].vue`; idem `RoleRowActions` em `index.vue`) ou usar os nomes `RolesRole...`. Recomenda-se validar no navegador depois.

### M1 (Média) Ausência de teste do comportamento do acordeão
- Tri-state sob filtro, congelamento de "só marcadas", abertura forçada na busca: lógica só no componente (`RolePermissionsAccordion.vue:26-72`), sem teste. Um teste de montagem teria pego o B1.

### M2 (Média) `refresh()` falho após salvar descarta edições
- `[id].vue:427-428`: `await refresh()` seguido de `syncForm()`. Se o refresh falhar (cai no catch, `syncForm` não roda: ok). Se refresh "suceder" com dados velhos, `syncForm` reaplica o original antigo. Risco baixo; sem evidência de ocorrência. Registrado como observação.

### B-menor
- m1: `onBeforeRouteLeave` com `confirmLeave` chamado duas vezes seguidas sobrescreve `leaveResolver` (`[id].vue:268-273`); a primeira Promise nunca resolve. Caso raro (duas navegações simultâneas).
- m2: `aria-controls` aponta para id inexistente quando o grupo está fechado, e o id usa `resource` cru (pode ter caracteres inválidos) (`RolePermissionsAccordion.vue:151,187`).
- m3: durante a busca, o botão do grupo mantém `aria-expanded=true` mas o clique é no-op (`:52-61`), sem indicação ao usuário.
- m4: `aria-label` do checkbox de grupo ("Marcar todas as permissões de X") difere do texto visível ("Marcar todas"); a regra de rótulo-no-nome (WCAG 2.5.3) é parcialmente ferida.
- m5: teste de ordenação pt-BR (`role-permissions.test.ts`) não discrimina acentos (Agendamentos/Geral/Papéis já ordenam igual em qualquer collation).
- m6: nenhum teste trava o comportamento dos `includes` pré-existentes em `useRoleResources` (só os 5 novos, fallback e cobertura do catálogo). Verifiquei no diff que a ordem preserva os includes (match exato apenas antecede) e que o label "Geral" continua antes; sem regressão aparente.
- m7: `server/api/roles/index.get.ts` não chama `requireOrgPermission` (pré-existente, só exige autenticação); `resolveOrgLicense` ignora erro de consulta e vira `planKey=null`, subcontando ações gated por plano silenciosamente (comportamento herdado de `license.ts`).

## Verificações pedidas (resultado)

Payload/API/gates (OK)
- `saveRole`: PUT `/api/roles/:id` com `{display_name, description}` e POST `/api/roles/:id/actions` com `{action_id, is_granted}` idênticos ao HEAD (`git show HEAD:[id].vue`, linhas 338-373). Só mudou o cálculo dos alterados (agora `diffPermissions`, equivalente).
- Gates `ROLES_READ/UPDATE/MANAGE_PERMISSIONS/CREATE/DELETE` mantidos; nenhum ActionCode novo. `ROLES_CREATE` agora também usado no alerta de papel de sistema (código existente).

Dirty/guarda (OK, com ressalvas m1/M2)
- Salvar com sucesso: `refresh()` + `syncForm()` zera dirty (`:426-428`). Falha: catch mantém o estado editado, dirty permanece.
- `refresh()` por vínculo de usuário não chama `syncForm` (watch só em `role.id`, `:447-450`), então edições pendentes são preservadas; `originalPermissionState` recalcula, mas só difere se o servidor mudou.
- Papel de sistema: `canEditMetadata/Permissions` falsos, `isDirty` falso, sem guarda nem beforeunload ativo.
- `isSaving` libera a navegação (`:283`) para não bloquear pós-save.
- `onBeforeRouteUpdate` só guarda se `params.id` mudou; `beforeunload` adicionado/removido em mounted/unmount.
- Descartar: `syncForm()` + toast; desabilitado quando não dirty ou salvando.

Acordeão (OK exceto B1, M1, m2-m4)
- Busca sem acento (`normalizeSearchText` NFD) em nome+código+descrição; "só marcadas" congelado em `frozenState` (reavaliado ao mudar busca/filtro/ações); tri-state calculado sobre os itens visíveis e `setGroup` só atua sobre eles; contagem n/m usa todas as ações do grupo; estado vazio com "Limpar filtros"; grupos ordenados por rótulo com `localeCompare('pt-BR')`; alvos `min-h-11`.

Mapa de resources (OK)
- Enum ganhou 5 membros; `EXACT_RESOURCE_META` checado antes dos includes; fallback `Outros (valor)`. O teste do catálogo (`actions-prod-103.json`, >20 resources, nenhum "Outros") falharia se um resource ficasse sem mapa. Mutação não executada.

index.vue (OK exceto B1)
- DELETE real em `server/api/roles/[id].delete.ts:25-31` responde 409 se houver `user_profiles` com o `role_id` na organização; o botão de confirmar é desabilitado por `assigned_users_count` (`confirm-disabled`, prop existe em `AppConfirmModal.vue:12`). Como a contagem é aditiva e opcional, se ausente o servidor ainda protege (409).
- Sem handlers duplicados; tabela desktop (`md`+) e lista mobile compartilham `RoleRowActions` e os mesmos handlers; `@click.stop` evita acionar `@select` da linha.
- `[id].delete.ts` filtra `organization_id`, então papel de sistema não é excluível por qualquer caminho.

Servidor (OK)
- Campos aditivos `assigned_users_count` e `granted_actions_count` preservam o shape `{items}`.
- Tenant: usuários contados com `.eq('organization_id', organizationId)`; papéis seguem o filtro existente org + sistema; role_actions só dos `roleIds` visíveis.
- Plano: `filterActionsByPlan` com `planKey` da org, mesma regra de `[id].get.ts:82`.
- Sem N+1: 3 consultas em lote em `Promise.all` (actions, role_actions, user_profiles) + licença.
- Limite 1000 linhas: `fetchAllPages` pagina com `.order('id').range()` e para quando a página vem < 1000; erro vira 500. Ordenação estável por `id` presente nas três tabelas (confirmado pelos tipos usados). `computeRoleCounts` deduplica e ignora linhas de papéis fora da lista.

## Não pôde ser verificado
- Comportamento em runtime/navegador (inclusive confirmação do B1, que é inferência a partir de `.nuxt/components.d.ts`).
- Exit code real do `pnpm typecheck`.
- Testes de mutação, acessibilidade real com leitor de tela, foco após abrir/fechar modais.
- Esquema real do banco (existência da coluna `id` em `role_actions`/`user_profiles`; inferida do uso em outros endpoints).
- Alegações do relatório do developer não reproduzidas além dos testes e do diff listados acima.
