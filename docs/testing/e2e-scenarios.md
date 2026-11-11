# Cenários E2E (navegador) — catálogo central

> Criado em 2026-11-09. Substitui a tabela E1–E12 de `docs/testing/test-plan.md` §9 como **fonte única dos cenários de ponta a ponta**.
> Aqui ficam os cenários; o plano geral só aponta para cá. Cada cenário tem ID estável (`J<jornada>-<nn>`) para ser citado em teste, PR e `known-failures.md`.

---

## 1. Diagnóstico dos E2E atuais

Foi feita uma leitura de `tests/e2e/*.e2e.ts` (7 specs, 678 linhas) contra o que o produto oferece (`app/pages/**`: 70 telas).

| Spec | O que faz de verdade | Veredito |
|---|---|---|
| `app-smoke.e2e.ts` | Abre cada tela do `/app` e confere que não há erro de JavaScript | **Só "a tela abre".** Não clica, não preenche, não confere dado |
| `admin-panel.e2e.ts` | Menu do admin, Ctrl+K, tema escuro | Navegação e aparência; nenhuma ação de negócio |
| `routing*.e2e.ts` | Redirecionamento por perfil | Válido (só o navegador prova), mas é pouco |
| `auth-session.e2e.ts` | Login pelo formulário, senha errada, logout | **Único spec que usa a UI de verdade** |
| `guest-flows.e2e.ts` | Validação de formulários e `401` para visitante | Validação de formulário + chamadas de API |
| `money-flows.e2e.ts` | Receber, parcelar, estornar, cancelar, isolamento | **É teste de API** (`api.post(...)` + consulta ao banco). Excelente, mas **nenhum clique em tela** |

**Conclusão:** o dinheiro e o isolamento estão bem cobertos *por API*; o que **nunca foi exercitado é o caminho do usuário**: abrir o modal,
preencher, clicar em "Receber", ver o saldo mudar na tela. Um bug no `PaymentModal.vue` (botão desabilitado, valor errado enviado,
campo não validado, lista que não atualiza) passa em todos os testes de hoje.

Regra a partir de agora: **um cenário só conta como E2E se o passo de ação for feito pela interface** (clique, digitação, upload) e a
verificação olhar **a tela e o banco**. Preparação de dados (criar org, usuário, OS pronta) pode ser por API/seed; a ação testada, não.

### Convenções para escrever o teste

1. **Arrange por API/seed, Act pela UI, Assert na tela + banco.** O asserto de banco usa o `world.db` já existente em `tests/e2e/support`.
2. **Asserção de efeito, não de presença.** Proibido terminar em `toBeVisible()` de título. Confira número exibido, linha na tabela, toast, mudança de status, saldo.
3. **Cada cenário cria seus dados** (como `setup()` em `money-flows`) e não depende de ordem.
4. **Um caminho negativo por caminho feliz** (validação, permissão, duplicidade) na mesma jornada.
5. **Seletores por papel/rótulo** (`getByRole`, `getByLabel`), não por classe CSS. Onde faltar rótulo acessível, corrigir o componente (`data-testid` só em último caso).
6. **Mobile (`@mobile`, 390 px)** só nos cenários marcados 📱; não duplicar a suíte inteira.
7. Os passos abaixo descrevem o **comportamento esperado**; os rótulos exatos dos botões devem ser confirmados no componente ao implementar.

### Legenda

- **Prio.:** **P0** dinheiro/segurança/acesso · **P1** fluxo principal do dia a dia · **P2** secundário.
- **Estado:** ✅ coberto na UI · 🟡 coberto **só por API** (falta a versão pela tela) · ⬜ não coberto.
- 📱 repetir em viewport mobile.

---

## 2. Perfis e dados-base (já existem em `support/world.ts`)

| Perfil | Descrição |
|---|---|
| `admin` | Administrador da oficina A (plano `pro`) |
| `staff` | Funcionário da oficina A com papel limitado |
| `otherOrg` | Administrador da oficina B (isolamento) |
| `platformOwner` | Dono da plataforma (`is_owner`) |
| `noOrg` | Logado sem oficina |
| `pendingOnboarding` | Oficina criada, onboarding incompleto |
| *a criar* | `starter` (oficina A em plano básico), `inactive` (assinatura cancelada), `terminated` (funcionário desligado) |

---

## 3. Catálogo de jornadas

### J1 — Entrar na plataforma (cadastro, assinatura, onboarding)

| ID | Cenário | Passos (UI) | Resultado esperado (tela + banco) | Prio. | Estado |
|---|---|---|---|---|---|
| J1-01 | Cadastro completo | `/signup` → preencher nome, e-mail, senha válida → enviar | Usuário criado em `auth.users` + `user_profiles` **sem organização**; vai para `/subscription` | P0 | ⬜ |
| J1-02 | Cadastro com e-mail já existente | `/signup` com e-mail de usuário existente | Mensagem de erro; nenhum usuário novo; sem sessão | P1 | ⬜ |
| J1-03 | Validação do formulário | E-mail inválido, senha curta, campos vazios | Erros por campo; nenhuma chamada à API | P2 | ✅ |
| J1-04 | Escolher plano e pagar (Stripe teste) | `/subscription` → escolher plano → checkout Stripe de teste → `checkout/success` | Org criada, assinatura `active`, usuário vira admin da org; segue para `/onboarding` (nightly, opcional) | P1 | ⬜ |
| J1-05 | Onboarding completo | `/onboarding` → preencher dados da oficina (razão social, CNPJ/CPF, telefone, endereço) → concluir | `onboarding_completed = true`; cai em `/app`; recarregar a página **não** volta ao onboarding | P0 | ⬜ |
| J1-06 | Onboarding com dados inválidos | CNPJ inválido, telefone vazio | Bloqueia, mostra o erro no campo, nada é gravado | P1 | ⬜ |
| J1-07 | Onboarding interrompido | Fechar a aba no meio e voltar a `/app` | É redirecionado para `/onboarding` com o que já foi salvo | P2 | ⬜ |
| J1-08 | Assinatura vencida/cancelada | Logar com org `is_active=false` | Barrado em `/app`, orientado a regularizar a assinatura | P0 | ⬜ |
| J1-09 | CEP preenche endereço | No onboarding, digitar CEP válido | Logradouro/bairro/cidade/UF preenchidos; CEP inexistente mostra aviso sem travar | P2 | ⬜ |

### J2 — Sessão e recuperação de acesso

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J2-01 | Login feliz → destino por perfil | Logar como admin / owner / sem org / onboarding pendente | `/app`, `/admin`, `/subscription`, `/onboarding` | P0 | ✅ |
| J2-02 | Senha errada não revela se o e-mail existe | Logar com e-mail existente e com inexistente | **Mesma** mensagem nos dois casos; sem cookie de sessão | P0 | 🟡 (só o caso "existe") |
| J2-03 | Logout encerra a sessão | Menu do usuário → Sair → voltar com o botão do navegador | Pede login; cookies removidos; dados da oficina não aparecem no cache | P0 | ✅ |
| J2-04 | Esqueci a senha → redefinir | `/forgot-password` → enviar → abrir link (token gerado pelo seed) → nova senha → logar com ela | Senha antiga deixa de funcionar; nova funciona; link usado não funciona de novo | P1 | ⬜ |
| J2-05 | Link de redefinição expirado/inválido | Abrir `/reset-password` com token ruim | Mensagem clara e opção de pedir novo link | P1 | ⬜ |
| J2-06 | Trocar senha logado | Configurações → perfil → senha atual + nova | Exige a atual; erra a atual → recusa; ao acertar, sessão continua | P1 | ⬜ |
| J2-07 | Sessão expira no meio do uso | Invalidar o token com a tela aberta e clicar em algo | Renova sozinho (refresh) ou leva ao login **sem perder o formulário preenchido** quando possível | P1 | ⬜ |
| J2-08 | Funcionário desligado é barrado | Preencher `termination_date` passado enquanto ele está logado e navegar | Próxima navegação → 403/login; `user_profiles.is_active` = `false` | P0 | ⬜ |
| J2-09 | Duas abas: sair numa, a outra reage | Logout na aba 1, clicar na aba 2 | A aba 2 vai para o login, sem tela quebrada | P2 | ⬜ |
| J2-10 | Excluir a própria conta | Configurações → excluir conta (confirmação) | Dados apagados/anonimizados; não consegue mais logar | P1 | ⬜ |

### J3 — Cadastros base (clientes, veículos, agenda)

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J3-01 | Criar cliente PF | Clientes → Novo → nome, telefone, CPF → salvar | Linha na tabela; registro com a `organization_id` da sessão | P1 | ⬜ |
| J3-02 | Criar cliente PJ | Tipo de pessoa = PJ → CNPJ + razão social | Rótulo do documento muda para CNPJ; salva | P2 | ⬜ |
| J3-03 | CPF/CNPJ inválido ou duplicado | Salvar com documento inválido; com documento já cadastrado | Erro no campo, sem criar duplicata | P1 | ⬜ |
| J3-04 | Editar cliente | Abrir linha → alterar telefone → salvar | Tabela e histórico refletem o novo valor | P1 | ⬜ |
| J3-05 | Buscar e filtrar cliente | Digitar parte do nome; limpar | Lista filtra e restaura; caractere especial (`%`, `'`, `,`) não quebra a busca | P1 | ⬜ |
| J3-06 | Excluir cliente sem OS | Excluir → confirmar | Sai da lista (soft delete) | P1 | ⬜ |
| J3-07 | Excluir cliente **com OS** | Excluir cliente que tem OS | Recusa com mensagem ou preserva o histórico; OS não fica órfã | P0 | ⬜ |
| J3-08 | Importar clientes por planilha | Importar → arquivo com linhas válidas e inválidas | Resumo "N importados / M com erro"; as válidas entram, as inválidas são listadas | P2 | ⬜ |
| J3-09 | Criar veículo por consulta de placa | Veículos → Novo → digitar placa → buscar | Marca/modelo/ano preenchidos (serviço externo mockado); falha do serviço permite preencher à mão | P1 | ⬜ |
| J3-10 | Veículo vinculado ao cliente | Cliente → ver veículos → adicionar | Veículo aparece no cliente e na lista geral; placa duplicada recusada | P1 | ⬜ |
| J3-11 | Agendar e remarcar | Agenda → novo agendamento → arrastar/remarcar para outro dia → trocar visão mês/semana/dia | Evento aparece na data nova nas três visões; banco com a data nova | P1 | ⬜ |
| J3-12 | Agendamento → virar OS | Abrir agendamento → criar OS a partir dele | OS criada com cliente e veículo preenchidos | P2 | ⬜ |
| J3-13 | 📱 Cadastro no celular | Criar cliente em 390 px | Formulário utilizável, teclado não cobre o botão salvar | P2 | ⬜ |

### J4 — Estoque, produtos e compras

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J4-01 | Criar categoria e produto | Categorias → nova; Produtos → novo com preço, custo e estoque | Aparece na lista e no seletor da OS; código sequencial sem repetição | P1 | ⬜ |
| J4-02 | Categoria em uso não exclui | Excluir categoria com produto | Recusa com mensagem | P1 | ⬜ |
| J4-03 | Ajuste de estoque | Estoque → ajustar +/- com motivo | Saldo na tela e no banco; histórico registra quem e quando | P1 | ⬜ |
| J4-04 | Solicitação de compra → autorizar | Funcionário cria solicitação; admin autoriza | Status muda; autorizar de novo é impossível; funcionário sem permissão não vê o botão | P1 | ⬜ |
| J4-05 | Solicitação rejeitada | Admin rejeita com motivo | Status "rejeitada"; não vira compra | P2 | ⬜ |
| J4-06 | Compra → pagar | Compras → nova (fornecedor, itens, vencimento) → pagar pela tela | Estoque entra; despesa lançada; saldo da conta cai uma única vez | P0 | 🟡 |
| J4-07 | Devolução de compra | Devolver parte dos itens | Não aceita mais que o comprado; estoque e valor ajustados | P1 | ⬜ |
| J4-08 | Importar produtos por planilha | Importar com linhas inválidas | Lote parcial com relatório de erros | P2 | ⬜ |
| J4-09 | Fornecedor: criar, editar, excluir | CRUD pelo formulário | Lista atualiza; excluir com compras é recusado | P2 | ⬜ |

### J5 — Ordem de serviço (do orçamento à conclusão)

> **Detalhado em [e2e-service-orders.md](./e2e-service-orders.md)** (172 cenários: criação, comissão por funcionário, status, recebimento, estorno, relatórios, permissões). J5, J6 e J7 abaixo são o recorte geral; para a OS vale o catálogo novo.

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J5-01 | **Criar OS completa** | OS → Nova → cliente + veículo → adicionar serviço e peça (seletor de produto) → responsável → salvar | Número sequencial; total = Σ itens; estoque da peça não baixa até concluir (conferir regra real); aparece no card/lista | P0 | ⬜ |
| J5-02 | Criar como orçamento e converter | Criar status `estimate` → "aprovar" | Transição `estimate → open`; histórico guarda a mudança | P1 | ⬜ |
| J5-03 | Avançar o status | `open → in_progress → completed` pelos botões | Cada passo atualiza o card e o banco; status inválido (pular etapa) não é oferecido | P0 | ⬜ |
| J5-04 | Editar OS aberta | Alterar quantidade/preço e salvar | Total recalculado na tela e no banco; OS concluída não permite edição livre | P0 | ⬜ |
| J5-05 | Desconto e acréscimo | Aplicar desconto % e valor fixo | Total correto, arredondado a 2 casas; desconto maior que o total é recusado | P0 | ⬜ |
| J5-06 | Validação | Salvar sem cliente; sem itens; quantidade 0 | Erros por campo; nada gravado | P1 | ⬜ |
| J5-07 | Filtros e busca da lista | Filtrar por status, período, cliente, número | Só as OS esperadas; contadores batem | P1 | ⬜ |
| J5-08 | Numeração sob concorrência | Duas abas criam OS ao mesmo tempo | Números distintos e sequenciais | P1 | ⬜ |
| J5-09 | Excluir OS aberta / paga | Tentar excluir cada uma | Aberta: exclui (soft delete). Paga: recusa e orienta a desfazer o pagamento | P0 | ⬜ |
| J5-10 | Imprimir/exportar OS | Exportar PDF/CSV da OS | Arquivo baixa com o número, cliente e total corretos | P2 | ⬜ |
| J5-11 | 📱 Criar OS no celular | Fluxo J5-01 em 390 px | Concluível sem rolagem horizontal; seletor de produto utilizável | P1 | ⬜ |

### J6 — Receber pagamento da OS (a jornada de maior risco)

> Hoje coberta **só por API** (`money-flows.e2e.ts`). Cada cenário abaixo deve ser refeito **pelo `PaymentModal.vue`**, mantendo o asserto de banco que já existe.

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J6-01 | **Receber à vista** | OS concluída → Receber → forma PIX, conta X, valor total → confirmar | Toast de sucesso; badge "Paga"; saldo da conta X na tela de contas +total; 1 linha de extrato; 1 transação `income` | P0 | 🟡 |
| J6-02 | Receber parcelado (3×) | Receber → 3 parcelas, 1ª já paga | OS "Parcial"; lista de parcelas com status corretos; saldo só pelo valor pago | P0 | 🟡 |
| J6-03 | Pagar parcela a parcela | Abrir parcelas → pagar a 2ª parcial (40) depois o resto (60) → pagar a 3ª | Valores restantes atualizam a cada pagamento; ao quitar tudo, badge "Paga" | P0 | 🟡 |
| J6-04 | Soma das parcelas ≠ total | Editar valores no modal até a soma divergir | Botão desabilitado/erro **antes** de enviar; se burlar, servidor devolve 400 | P0 | 🟡 |
| J6-05 | Pagar acima do saldo da parcela | Digitar valor maior que o restante | Bloqueado na tela; nada gravado | P0 | 🟡 |
| J6-06 | Duplo clique em "Confirmar" | Clicar duas vezes rápido | **Um** único recebimento (botão trava durante o envio) | P0 | ⬜ |
| J6-07 | Reabrir/receber de novo OS já paga | Com a OS paga, abrir o modal | Botão "Receber" não existe; ação direta por URL recusada | P0 | 🟡 |
| J6-08 | Conta de outra oficina | Seletor de conta no modal | Lista só as contas da própria oficina | P0 | 🟡 |
| J6-09 | **Desfazer pagamento** | OS paga → Desfazer pagamento → confirmar | Saldo volta ao valor anterior, extrato estornado, OS volta a "Pendente"; ciclo receber→desfazer→receber mantém saldo certo | P0 | 🟡 |
| J6-10 | Cancelar OS com pagamento | Cancelar OS paga | Recusa com orientação; após desfazer, cancela e **não entra no faturamento** | P0 | 🟡 |
| J6-11 | Entrada (sinal) | "Entrada" na OS aberta | Registra receita parcial; ao concluir, só falta o restante | P1 | ⬜ |
| J6-12 | Recebimento extra | OS paga → receber valor extra | Registra à parte; total recebido > total da OS, saldo coerente | P1 | ⬜ |
| J6-13 | Maquininha/taxa | Receber em cartão com taxa configurada | Valor líquido e taxa registrados conforme a maquininha | P1 | ⬜ |
| J6-14 | Erro de rede ao confirmar | Derrubar a API durante o envio | Mensagem de erro; modal permanece; nada duplicado ao tentar de novo | P1 | ⬜ |
| J6-15 | 📱 Receber no celular | J6-01 em 390 px | Modal cabe na tela; botão confirmar sempre acessível | P0 | ⬜ |
| J6-16 | Invariante final | Ao fim de cada cenário J6 | Σ extrato (com sinal) == variação do saldo da conta (`expectCashConsistent`) | P0 | 🟡 |

### J7 — Comissão e bônus

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J7-01 | Criar plano de comissão | Financeiro → Comissões → novo plano (regra % por tipo de item) | Plano na lista; regra gravada | P1 | ⬜ |
| J7-02 | Atribuir plano a funcionário | Detalhe do plano/funcionário → atribuir | Funcionário aparece como atribuído | P1 | ⬜ |
| J7-03 | **OS paga gera comissão correta** | Receber OS com serviço e peça de funcionário comissionado | Comissão = valor do motor (L1) para o mês; aparece no relatório de comissões | P0 | ⬜ |
| J7-04 | Nova versão vale só do mês seguinte | Criar versão com vigência futura | OS do mês atual usa a regra antiga; do próximo, a nova | P0 | ⬜ |
| J7-05 | Override manual (apply/remove) | Aplicar e remover override numa OS | Valor muda e volta; log de auditoria registrado | P1 | ⬜ |
| J7-06 | Pré-visualizar impacto | "Impacto"/"Prévia" de mudança de regra | Lista funcionários afetados; **nada é gravado** | P1 | ⬜ |
| J7-07 | **Pagar comissões em lote** | Relatório/Comissões → selecionar → pagar | Saída financeira lançada, saldo cai, status "pago"; pagar de novo é impossível | P0 | 🟡 |
| J7-08 | Desfazer pagamento da OS afeta comissão | Estornar OS que gerou comissão | Comissão volta a pendente/é removida; relatório acompanha | P0 | ⬜ |
| J7-09 | Bônus por meta | Criar bônus (base receita) → atribuir 2 funcionários → gerar OS → ver progresso → gerar bônus do mês fechado | % de progresso correto; gera 1 lançamento; gerar de novo **não duplica**; desfazer geração remove o lançamento | P1 | ⬜ |
| J7-10 | Funcionário vê só a própria comissão | Logar como `staff` e abrir comissões | Só dados dele; CPF/valores de colegas não aparecem | P0 | ⬜ |

### J8 — Financeiro (lançamentos, contas, categorias)

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J8-01 | Criar conta bancária | Contas → nova (saldo inicial) | Aparece com saldo inicial; saldo **não** é editável por PUT depois | P0 | ⬜ |
| J8-02 | Excluir conta com lançamentos | Excluir | Recusa | P0 | ⬜ |
| J8-03 | **Lançar despesa e pagar** | Financeiro → Nova despesa → Pagar | Saldo cai **uma vez**; status "Pago"; resumo do período atualiza | P0 | 🟡 |
| J8-04 | Receita avulsa | Nova receita → marcar como recebida | Saldo sobe; aparece no fluxo de caixa | P1 | ⬜ |
| J8-05 | Pagamento em lote | Selecionar vários → pagar | Pendentes pagos, pagos ignorados, sem duplicar | P0 | 🟡 |
| J8-06 | Lançamento recorrente | Criar despesa mensal → ver ocorrências → pagar uma → editar "esta e futuras" → estender | Ocorrências nos meses certos (dia 31 em mês de 30 dias); escopo respeitado; excluir só uma mantém as outras | P1 | ⬜ |
| J8-07 | Categorias | Criar, editar cor/ícone, excluir; migrar lançamentos para outra | Lançamentos migram; categoria em uso não some | P2 | ⬜ |
| J8-08 | Filtros do financeiro | Período, status, categoria, conta, busca | Lista, totais e resumo coerentes entre si | P1 | ⬜ |
| J8-09 | Exportar | Exportar lançamentos | Arquivo baixa; célula que começa com `=`/`+`/`-`/`@` sai neutralizada | P1 | ⬜ |
| J8-10 | Maquininhas e impostos | CRUD de maquininha e de imposto | Taxa aplicada no recebimento (J6-13) | P2 | ⬜ |

### J9 — Relatórios (os números na tela)

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J9-01 | **Dataset conhecido → números exatos** | Semear OS/despesas fixas (golden) → abrir Visão geral, Lucro, Custos, Vendas | Cada card/total na tela igual ao valor escrito à mão | P0 | 🟡 (por API) |
| J9-02 | Filtro de período | Trocar mês/intervalo; "from" depois de "to" | Números mudam; intervalo inválido avisa | P1 | ⬜ |
| J9-03 | Comparação com período anterior | Ativar comparação | Variação %; período anterior zerado não mostra `Infinity`/`NaN` | P1 | ⬜ |
| J9-04 | Período vazio | Mês sem movimento | Zeros e estado vazio amigável | P1 | ⬜ |
| J9-05 | Devedores | OS concluída sem pagamento → aparece; quitar → sai | Total devido atualiza | P1 | 🟡 |
| J9-06 | Dashboard = relatório | Comparar faturamento do dashboard com a Visão geral | Mesmo valor | P0 | 🟡 |
| J9-07 | Exportar relatório (CSV/PDF) | Exportar | Download com o mesmo total da tela; sem dados de outra oficina | P1 | ⬜ |
| J9-08 | Relatórios por plano | Logar na oficina `starter` e abrir relatório `pro` | Bloqueado com convite ao upgrade | P0 | ⬜ |
| J9-09 | Paginação/ordenação das tabelas | Ordenar coluna e trocar de página | Total de registros constante; itens não repetem entre páginas | P2 | ⬜ |

### J10 — Equipe, papéis e permissões

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J10-01 | Cadastrar funcionário | Configurações → Funcionários → novo | Aparece na lista; dentro do limite do plano | P1 | ⬜ |
| J10-02 | **Limite do plano** | Oficina `starter` com 2 funcionários → adicionar o 3º | Bloqueado com convite ao upgrade; após upgrade (webhook) permite | P0 | ⬜ |
| J10-03 | Conceder acesso (convite) | Funcionário → conceder acesso com papel → logar com o novo usuário | Usuário criado e vinculado; entra em `/app` | P0 | ⬜ |
| J10-04 | **Papel limitado esconde ações** | Logar como `staff` sem `orders.cancel` | Botão "Cancelar" não aparece | P0 | ⬜ |
| J10-05 | **URL direta é barrada** | `staff` acessa `/app/financial/...` sem permissão | Vai para `/app/forbidden`; a API também devolve 403 | P0 | ⬜ |
| J10-06 | Admin altera o papel | Admin dá a permissão ao papel → `staff` recarrega | Botão aparece sem precisar deslogar | P0 | ⬜ |
| J10-07 | Criar/editar/excluir papel | Papéis → CRUD | Papel de sistema não edita/exclui; papel em uso não exclui | P0 | ⬜ |
| J10-08 | Funcionário não se promove | `staff` tenta abrir a tela de papéis/forçar a rota | Barrado na tela e na API | P0 | ⬜ |
| J10-09 | Desligar funcionário | Informar data de desligamento | Perde acesso na próxima navegação (ver J2-08) | P0 | ⬜ |
| J10-10 | Matriz de visibilidade do menu | Para cada papel, abrir o menu | Itens exibidos = permissões do papel (tabela esperada versionada no teste) | P1 | ⬜ |

### J11 — Assinatura, plano e cobrança

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J11-01 | Ver assinatura | Configurações → Assinatura | Plano, status, próxima cobrança e faturas corretos | P1 | ⬜ |
| J11-02 | Upgrade de plano | Escolher plano superior (Stripe teste) | Recursos liberados após o webhook | P1 | ⬜ |
| J11-03 | Cancelar assinatura | Cancelar → confirmar | Status "cancelando"/`cancelled` conforme regra; acesso mantido até o fim do período | P0 | ⬜ |
| J11-04 | Recurso fiscal fora do plano | Abrir NFS-e sem o plano `fiscal` | Bloqueio com CTA de upgrade | P0 | ⬜ |
| J11-05 | `billing/success` e `billing/cancel` | Voltar do checkout (sucesso e cancelado) | Mensagem correta; estado não muda no cancelamento | P1 | ⬜ |

### J12 — Fiscal (NFS-e)

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J12-01 | Configurar empresa fiscal | Empresa → dados fiscais → sincronizar (Focus mockada) | Status "sincronizado"; log gravado | P1 | ⬜ |
| J12-02 | Emitir NFS-e a partir da OS | OS paga → Emitir NFS-e | Status "processando" → "autorizada" via webhook; PDF/XML disponíveis | P1 | ⬜ |
| J12-03 | Emissão rejeitada | Focus devolve erro | Mensagem tratada; OS continua sem nota; log registrado | P1 | ⬜ |
| J12-04 | Enviar por e-mail | Nota autorizada → enviar | Confirmação; erro de e-mail exibido sem quebrar a tela | P2 | ⬜ |
| J12-05 | **Cancelar NFS-e** | Nota autorizada → cancelar com justificativa | Cancela (hoje falha 403 — `requireOwner`; vira regressão) | P1 | ⬜ |

### J13 — Painel do dono da plataforma (`/admin`)

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J13-01 | Menu e telas abrem | Já coberto | — | P2 | ✅ |
| J13-02 | Listar e abrir oficina | Oficinas → buscar → abrir detalhe | Dados da oficina certa; busca filtra | P1 | ⬜ |
| J13-03 | Suspender/reativar oficina | Alterar `is_active` | Usuários da oficina perdem/recuperam acesso (J1-08) | P0 | ⬜ |
| J13-04 | Usuários, faturas e assinaturas | Filtrar e abrir | Números batem com o banco | P1 | ⬜ |
| J13-05 | Auditoria | Executar ação no app (ex.: pagar comissão) e abrir `/admin/audit` | Evento aparece com autor, ação e data | P1 | ⬜ |
| J13-06 | Métricas e feedbacks | Abrir métricas; enviar feedback como oficina e ver no admin | Feedback chega; contagens coerentes | P2 | ⬜ |
| J13-07 | Admin de oficina não entra | Admin da oficina abre `/admin/*` | Redirecionado para `/app` | P0 | ✅ |

### J14 — Isolamento entre oficinas, pela interface

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J14-01 | Listas só mostram a própria oficina | Oficina B logada abre clientes, OS, produtos, contas, relatórios | Nenhum dado da A (dados identificáveis semeados na A) | P0 | 🟡 |
| J14-02 | URL com id de outra oficina | B abre `/app/financial/commissions/<id da A>` e demais telas com `[id]` | 404/forbidden, sem vazar nome | P0 | ⬜ |
| J14-03 | Seletores | Seletor de cliente/produto/conta/funcionário em qualquer formulário | Só opções da própria oficina | P0 | ⬜ |
| J14-04 | Exportações | Exportar CSV/PDF | Só linhas da própria oficina | P0 | ⬜ |

### J15 — Páginas públicas, SEO e responsividade

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J15-01 | Páginas públicas respondem | `/`, `/pricing`, `/perguntas-frequentes` | 200, `<title>`, `canonical`, no sitemap | P2 | ✅ |
| J15-02 | Preços coerentes com o produto | Comparar planos exibidos com limites reais | Mesmos números de `usePlans.ts` e do servidor | P1 | ⬜ |
| J15-03 | CTA leva ao fluxo certo | "Começar" na home | Abre `/signup` (ou plano pré-selecionado) | P1 | ⬜ |
| J15-04 | 📱 Sem rolagem horizontal | Home, pricing, login em 390 px | Sem overflow horizontal | P2 | ✅ (só home) |
| J15-05 | 📱 Navegação inferior | `MobileBottomNav` em 390 px | Cada item leva à tela certa e destaca o ativo | P1 | ⬜ |
| J15-06 | Página inexistente | `/rota-que-nao-existe` | Página 404 amigável, sem erro de console | P2 | ⬜ |

### J16 — Resiliência e erros (transversal)

| ID | Cenário | Passos | Resultado esperado | Prio. | Estado |
|---|---|---|---|---|---|
| J16-01 | API fora do ar | Falha em `/api/...` ao abrir uma lista | Estado de erro com "tentar de novo"; tela não fica em branco | P1 | ⬜ |
| J16-02 | Supabase Auth fora do ar | Auth indisponível | 503 tratado: **não** desloga o usuário | P0 | ⬜ |
| J16-03 | Formulário protege contra perda | Fechar modal com dados preenchidos | Pede confirmação | P2 | ⬜ |
| J16-04 | Sem erro de console nas telas | Já coberto por `app-smoke` | — | P2 | ✅ |
| J16-05 | Acessibilidade básica | Rodar axe em login, OS, modal de pagamento | Sem violações graves (contraste, rótulo, foco no modal) | P2 | ⬜ |

---

## 4. Resumo e ordem de implementação

| Jornada | Cenários | P0 | Já cobertos na UI | Só por API |
|---|---:|---:|---:|---:|
| J1 Entrada | 9 | 3 | 1 | 0 |
| J2 Sessão | 10 | 4 | 2 | 1 |
| J3 Cadastros | 13 | 1 | 0 | 0 |
| J4 Estoque/compras | 9 | 1 | 0 | 1 |
| J5 Ordem de serviço | 11 | 5 | 0 | 0 |
| J6 Receber pagamento | 16 | 12 | 0 | 9 |
| J7 Comissão/bônus | 10 | 5 | 0 | 1 |
| J8 Financeiro | 10 | 4 | 0 | 2 |
| J9 Relatórios | 9 | 3 | 0 | 3 |
| J10 Equipe/permissões | 10 | 8 | 0 | 0 |
| J11 Assinatura | 5 | 2 | 0 | 0 |
| J12 Fiscal | 5 | 0 | 0 | 0 |
| J13 Admin | 7 | 2 | 2 | 0 |
| J14 Isolamento | 4 | 4 | 0 | 1 |
| J15 Público/mobile | 6 | 0 | 2 | 0 |
| J16 Resiliência | 5 | 1 | 1 | 0 |
| **Total** | **139** | **55** | **8** | **18** |

**Ordem sugerida** (cada passo entrega valor sozinho):

1. **J6 + J5** — o caminho OS → receber → desfazer pela tela (maior risco financeiro, já tem o asserto de banco pronto para reaproveitar).
2. **J10 + J14** — permissões e isolamento vistos pelo usuário (R1/R2).
3. **J1 + J2** — entrada na plataforma e sessão.
4. **J8 + J7 + J9** — financeiro, comissão e números dos relatórios.
5. **J3, J4** — cadastros e compras.
6. **J11, J12, J13, J15, J16** — restante.

**Infra a criar antes:** page objects mínimos (`OrdersPage`, `PaymentModal`, `FinancialPage`) em `tests/e2e/support/pages/`; helper `expectCashConsistent` já existe e deve ser reaproveitado; usuários `starter`, `inactive` e `terminated` no `world.ts`; mock de Stripe/Focus/placa/CEP no nível do servidor (MSW) para J1-04, J3-09, J12.

**Relação com a pirâmide:** vários cenários acima têm a regra testável em camada mais barata (comissão = L1, soma de parcelas = L3). O E2E só confirma que **a tela chama e mostra o que o servidor calcula**, por isso cada cenário traz um único resultado de negócio, não variações numéricas.

## 5. Como manter este documento

- Ao implementar um cenário, troque o **Estado** para ✅ e anote o arquivo (`tests/e2e/<jornada>.e2e.ts`) no título do `test(...)` com o ID, ex.: `test('J6-01 receber à vista', ...)`.
- Cenário que revelar defeito: abrir item `KF-nn` em `known-failures.md`, usar `test.fail()` (equivalente ao `it.fails`) e citar o ID aqui.
- Cenário novo: acrescentar na jornada certa com o próximo número; **nunca renumerar** (os IDs são citados em outros lugares).
- Atualizar a tabela de resumo (§4) na mesma alteração.
