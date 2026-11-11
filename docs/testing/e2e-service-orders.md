# Cenários E2E — Ordem de Serviço (Playwright)

> Criado em 2026-11-09. Detalha as jornadas J5 (OS), J6 (receber) e J7 (comissão) de [e2e-scenarios.md](./e2e-scenarios.md) para o **núcleo do produto**.
> Tudo parte da OS: cliente, veículo, itens, responsáveis, comissão, recebimento, caixa, relatórios, nota fiscal. Por isso este é o catálogo mais completo.
>
> **Regra de ouro:** a ação é feita **pela tela** (clique, digitação, seleção) e a verificação olha **a tela e o banco**.
> Preparar dados por API/seed é permitido; o passo que o cenário testa, não.

Fontes lidas: `app/pages/app/service-orders.vue`, `app/components/service-orders/**` (CreateModal, PaymentModal, DownPaymentModal, ExtraPaymentModal, OrderCard, detail/*, quote/*),
`app/utils/service-orders.ts`, `lib/utils/employee-commission-engine.ts`, `docs/testing/financial-core-test-analysis.md` e `known-failures.md`.

---

## 1. O que a tela oferece (base dos cenários)

| Área | O que existe | Rótulos reais |
|---|---|---|
| **Lista** | Cards, rolagem infinita (20 por página), filtros sincronizados com a URL, busca com atraso de 500 ms | Filtros: *Status, Cliente, Veículo, Responsável, Data de entrada, Limpar* · Status: *Orçamento, Aberta, Em andamento, Aguard. peça, Concluída, Faturada, Entregue, Cancelada* |
| **Avançar status** (no card e no detalhe) | `estimate → open → in_progress → completed` | *Abrir OS · Iniciar · Concluir* · toast *Status atualizado* |
| **Criar/Editar** (modal) | Cliente (busca por nome/CPF/telefone), veículo (busca por placa/marca/modelo), produto master, status, datas, itens, responsáveis, imposto, desconto, agendamento | *Criar OS / Salvar alterações* · *Adicionar Produto/Serviço · Adicionar manual* · toasts *OS criada com sucesso*, *OS atualizada com sucesso*, *Número já existe* |
| **Responsáveis** | Vários por OS, sem repetir; mostra a comissão estimada de cada um e o motivo | *Adicionar* · *Comissão: R$ …* · notas *Por regra/categoria*, *Sem itens elegíveis*, *Sem comissão* · toasts *Responsável já selecionado*, *Todos os responsáveis já foram adicionados* |
| **Resumo financeiro** | Total, custo, imposto, comissão e *Margem estimada* | |
| **Detalhe** | Cabeçalho + cartões: Info, Cliente/Veículo, Itens, Responsáveis, Comissões, Financeiro, Parcelas | *Editar · Receber · Receber sinal · Receber avulso · Cancelar pagamento · Orçamento · Cancelar OS · Excluir OS* |
| **Receber** (PaymentModal) | Linhas de pagamento (forma, valor, status Pago/Pendente, conta, maquininha), nº de parcelas, entrada, data, *Liberar 100% da comissão* | *Registrar pagamento / Confirmar* · toasts *Pagamento registrado com sucesso*, *O total das linhas precisa bater com o saldo restante da OS*, *Selecione a conta bancária em todas as linhas*, *O adiantamento recebido é maior que o valor final da OS* |
| **Sinal / Avulso** | Modais próprios | *Registrar sinal* (*Sinal registrado com sucesso*) · *Registrar recebimento* (*Recebimento registrado com sucesso*) |
| **Parcelas** | Pagar (inteira ou o restante), editar, excluir com motivo, cancelar recebimento | *Pagar · Receber restante · Excluir parcela · Cancelar recebimento* |
| **Orçamento** | Pré-visualização, imprimir, PDF | *Imprimir · Baixar PDF* |
| **Outros** | Duplicar OS, exportar CSV, emitir NFS-e | toasts *OS duplicada com sucesso*, *OS cancelada* |

### Regras de edição e status (`app/utils/service-orders.ts`)

| Status da OS | Pagamento | Pode editar? |
|---|---|---|
| `estimate`, `open`, `in_progress`, `waiting_for_part` | só `pending` | sim |
| `completed` | `pending` | sim |
| `completed` | `partial` ou `paid` | **não** |
| `invoiced`, `delivered`, `cancelled` | qualquer | **não** |

O avanço pelo botão só vai até `completed`. `waiting_for_part`, `invoiced` e `delivered` só se alcançam pela edição (status) ou fluxo fiscal.

---

## 2. Como os testes serão montados

### 2.1 Duas massas de dados, cada uma com um papel

| Massa | De onde vem | Para quê |
|---|---|---|
| **Catálogo fixo (§3)** | Criada pelo teste, por API, na oficina A do `world.ts`. Valores redondos e escolhidos à mão | **Todo cenário com número exato** (total, comissão, saldo). É o que dá para conferir a centavo |
| **Seed demo** | `pnpm seed:demo` (1.265 OS reais anonimizadas) | Volume e realismo: rolagem infinita, busca, filtros, relatórios com dados grandes, desempenho. **Sem valor exato de comissão** (os dados são reais e sujos) |

### 2.2 Estrutura de arquivos

```
tests/e2e/service-orders/
  support/
    catalog.ts          # constrói o catálogo fixo por API (categorias, produtos, clientes, veículos, funcionários, planos, contas)
    pages/              # page objects: OrdersListPage, OrderFormModal, OrderDetail, PaymentModal, InstallmentsCard...
    db.ts               # leituras de asserção: saldo, extrato, parcelas, comissões, status
  01-listagem.e2e.ts          05-detalhe-orcamento.e2e.ts      09-comissao.e2e.ts
  02-criacao.e2e.ts           06-receber.e2e.ts                10-relatorios.e2e.ts
  03-comissao-preview.e2e.ts  07-desfazer-cancelar.e2e.ts      11-permissoes-isolamento.e2e.ts
  04-status-edicao.e2e.ts     08-parcelas-avulso-sinal.e2e.ts  12-volume-seed-demo.e2e.ts
```

Nome do teste = ID do cenário + comportamento: `test('OS-C-03 desconto rateado reduz a comissão de quem tem regra por receita', …)`.

### 2.3 Convenções específicas

1. **Cada teste cria a própria OS** (por API ou pela tela) e uma conta bancária nova com saldo conhecido. Nada depende de ordem.
2. **Número exibido na tela == número gravado no banco**, sempre nos dois lados (o prévia do modal e o que foi salvo podem divergir: bug clássico).
3. **Toda OS que recebe dinheiro termina com a invariante de caixa**: Σ extrato (com sinal) == variação do saldo (`expectCashConsistent`, já existe em `money-flows.e2e.ts`).
4. **Comissão se confere em três pontos**: prévia no modal, cartão *Comissões* do detalhe e registro em `employee_financial_records`.
5. **Datas**: o mês importa para a versão da regra. Os testes que dependem do mês fixam a `entry_date` na tela, não o relógio do sistema.
6. **Bug conhecido** vira `test.fail()` com o `KF-nn` no título, e passa a falhar (alertando) quando for corrigido.

---

## 3. Massa de dados fixa (catálogo)

Valores escolhidos para que a comissão de cada funcionário seja **diferente** na mesma OS e dê para conferir à mão.

### 3.1 Categorias e produtos

| Código | Produto | Categoria | Venda | Custo | Observação |
|---|---|---|---:|---:|---|
| S1 | Retífica de cabeçote | Serviços | 1.000,00 | 300,00 | serviço principal |
| S2 | Troca de óleo | Serviços | 150,00 | 50,00 | |
| S3 | Usinagem de bloco | Usinagem | 800,00 | 200,00 | outra categoria de serviço |
| S4 | Serviço com centavos | Serviços | 33,33 | 10,00 | quantidade 3 → 99,99 (teste de arredondamento) |
| S5 | Serviço no prejuízo | Serviços | 100,00 | 150,00 | lucro negativo |
| P1 | Junta do cabeçote | Peças | 200,00 | 120,00 | |
| P2 | Jogo de válvulas | Peças | 480,00 | 300,00 | |
| P3 | Parafuso | Peças | 10,00 | 4,00 | quantidade alta |
| K1 | Kit revisão (grupo) | Serviços | soma dos itens | soma dos custos | produto do tipo grupo |
| M1 | *Mão de obra avulsa* | — (manual) | 100,00 | 0,00 | item **adicionado manualmente**, sem categoria |

### 3.2 Clientes e veículos

| Cliente | Tipo | Veículos | Para quê |
|---|---|---|---|
| **C1** Marcos Pessoa | PF | V1 Fiat Uno ABC1D23 · V2 VW Gol DEF4G56 | cliente com 2 veículos (o seletor só mostra os dele) |
| **C2** Transportadora Alfa Ltda | PJ | V3 Scania R450 | CNPJ, busca por documento |
| **C3** José d'Ávila | PF | — | sem veículo; nome com acento e apóstrofo (busca) |
| **C4** *(sem cliente)* | — | — | OS de balcão sem cliente |

### 3.3 Funcionários e planos de comissão (cada um muda o resultado)

| Funcionário | Plano | Regras | Resultado esperado |
|---|---|---|---|
| **Ana** | *Geral 10%* | padrão: 10 % da **receita** | comissão em todo item |
| **Bruno** | *Retífica* | Serviços + Usinagem: 30 % do **lucro** · padrão: 5 % da receita | lucro nos serviços; receita nas peças |
| **Carla** | *Peças fixo* | só Peças: **R$ 20 por unidade** · sem regra padrão | serviço e item manual **não** geram comissão |
| **Diego** | *(sem plano)* | — | nota *Sem comissão* |
| **Elisa** | *Escalonado* | versão antiga (2 meses atrás): padrão 8 % receita · versão atual: padrão 12 % receita | o mês da OS define a taxa |
| **Fábio** | *Geral 10%* **e** *Peças fixo* | duas atribuições | peças: regra específica (R$ 20/un.) vence a padrão; resto: 10 % |

### 3.4 Contas e maquininha
- **Conta Caixa** (saldo inicial 1.000,00) e **Conta Banco** (saldo inicial 5.000,00), sempre novas por teste.
- **Maquininha** com taxa de crédito 3 % (para o recebimento em cartão).

### 3.5 Tabela-verdade da comissão (referência dos cenários)

**OS-REF1**: S1 ×1 (1.000) + P1 ×2 (400) = **1.400,00**, custo **540,00**.

| Funcionário | Sem desconto | Desconto R$ 140 (total 1.260) | Cálculo (com desconto) |
|---|---:|---:|---|
| Ana | 140,00 | **126,00** | 10 % × (900 + 360) |
| Bruno | 230,00 | **198,00** | S1: 30 % × (900 − 300) = 180 · P1: 5 % × 360 = 18 |
| Carla | 40,00 | **40,00** | só P1: 20 × 2 (fixo não sofre desconto) |
| Diego | 0 | **0** | sem plano |
| Elisa (mês atual) | 168,00 | **151,20** | 12 % × 1.260 |
| Fábio | 140,00 | **130,00** | S1: 10 % × 900 = 90 · P1: fixo 20 × 2 = 40 |

Com **imposto de 5 %** sobre 1.400 (= 70,00), sem desconto: Bruno = S1: 30 % × (1.000 − 300 − 50) = 195 + P1: 20 = **215,00** (o imposto entra no lucro, não na receita).

Margem estimada de OS-REF1 com desconto e responsáveis Ana + Bruno + Carla: 1.260 − 540 − (126 + 198 + 40) = **356,00**.

Outros números de referência:
- **Arredondamento:** S4 ×3 = 99,99; Ana: 10 % = 9,999 → **10,00** (arredonda por item).
- **Lucro negativo:** S5 ×1; Bruno (30 % do lucro): lucro = máx(0; 100 − 150) → **0,00** (nunca negativa).
- **Fixo × quantidade:** P3 ×10; Carla: R$ 20 × 10 = **200,00**, mesmo com o item custando R$ 100 no total.
- **Liberação proporcional:** a comissão liberada = direito × (recebido ÷ total). OS-REF1 com desconto, recebendo 630,00 (50 %): Ana **63,00**, Bruno **99,00**, Carla **20,00**; ao quitar: 126 / 198 / 40.
- **Liberar 100 % da comissão agora** (opção do modal, irreversível): com 30 % de entrada, a comissão já sai **inteira**.

---

## 4. Cenários

Legenda: **P0** dinheiro/segurança · **P1** fluxo principal · **P2** secundário · 📱 repetir em 390 px · 🟡 há cobertura só por API (falta a tela) · ⬜ não coberto · 🐞 bug conhecido (`test.fail`).
Os passos descrevem o comportamento esperado; rótulos exatos devem ser confirmados no componente ao implementar. Onde o comportamento atual é **incerto**, o cenário diz "**caracterizar**": o teste descobre e fixa o que o sistema faz hoje.

### OS-A — Lista, busca e filtros

| ID | Cenário | Passos (UI) | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-A-01 | Lista mostra a OS recém-criada | Criar OS pela tela → ver a lista | Card no topo com número, cliente, veículo, total e badges de status e pagamento corretos | P1 | ⬜ |
| OS-A-02 | Card mostra o botão certo para cada status | Uma OS em cada status | `estimate`→*Abrir OS*, `open`→*Iniciar*, `in_progress`→*Concluir*, `completed`/`cancelled`→nenhum botão de avanço | P1 | ⬜ |
| OS-A-03 | Filtro por status | Escolher cada status do filtro | Só OS do status; contador *Filtros (1)*; URL ganha `?status=` | P1 | ⬜ |
| OS-A-04 | Filtro por cliente / veículo / responsável | Selecionar cada um | Só as OS dele; combinar dois filtros faz interseção | P1 | ⬜ |
| OS-A-05 | Filtro por período | Intervalo de *Data de entrada* | Só OS dentro; limites inclusivos; só **um** extremo preenchido não filtra (a tela só usa o filtro com os dois) — **caracterizar** | P1 | ⬜ |
| OS-A-06 | Limpar filtros | Aplicar 3 filtros → *Limpar* | Lista completa; URL sem parâmetros; contador some | P2 | ⬜ |
| OS-A-07 | URL como estado | Abrir `/app/service-orders?status=open&clientId=…` direto | Filtros já aplicados e refletidos nos controles; recarregar mantém | P1 | ⬜ |
| OS-A-08 | Busca por número | Digitar `OS4001` | Só aquela OS, após ~0,5 s | P1 | ⬜ |
| OS-A-09 | Busca por nome do cliente, placa e telefone | Termos de cada tipo | Encontra; **acento e apóstrofo** (`José d'Ávila`) não quebram a busca | P0 | ⬜ |
| OS-A-10 | Busca com caracteres especiais | `%`, `_`, `,`, `)`, aspas | Sem erro 500, sem trazer tudo; resultado vazio coerente | P0 | ⬜ |
| OS-A-11 | Estado vazio | Filtro sem resultado | Mensagem de vazio, sem tela quebrada; *Limpar* disponível | P2 | ⬜ |
| OS-A-12 | Rolagem infinita (seed demo) | Rolar a lista de 1.265 OS | Carrega de 20 em 20 sem repetir nem pular card; indicador de carregando; total coerente | P1 | ⬜ |
| OS-A-13 | Total filtrado × lista | Filtrar e contar | O total exibido == linhas que chegam ao fim da rolagem | P1 | ⬜ |
| OS-A-14 | Listagem não mostra OS excluída/cancelada indevidamente | Excluir uma OS aberta | Some da lista; OS cancelada continua visível com badge *Cancelada* | P0 | ⬜ |
| OS-A-15 | Exportar CSV | *Exportar* com filtro | Arquivo baixa; mesmas linhas e total da tela; célula começando com `=`/`+`/`-`/`@` neutralizada | P1 | ⬜ |
| OS-A-16 | 📱 Lista no celular | 390 px | Cards legíveis, filtros em painel, sem rolagem horizontal | P1 | ⬜ |

### OS-B — Criar OS

| ID | Cenário | Passos (UI) | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-B-01 | **Criar OS completa (caminho principal)** | Nova OS → C1 + V1 → S1 ×1 e P1 ×2 (seletor) → responsável Ana → *Criar OS* | Toast *OS criada com sucesso*; no banco: `total_amount`=1.400, itens com preço/custo/categoria, `entry_date`=hoje, `payment_status`=pending, cliente/veículo certos | P0 | ⬜ |
| OS-B-02 | Número automático e sequencial | Criar 3 OS seguidas | Números consecutivos; o campo mostra *Auto (ex: OS…)* antes de salvar | P0 | ⬜ |
| OS-B-03 | Número duplicado | Digitar um número já existente → salvar | Toast *Número já existe* com sugestão; campo é preenchido com a sugestão; nada gravado; segunda tentativa grava | P0 | ⬜ |
| OS-B-04 | Veículo depende do cliente | Escolher C1 → abrir veículos; trocar para C2 | Só V1/V2 para C1; só V3 para C2; trocar de cliente limpa o veículo anterior | P1 | ⬜ |
| OS-B-05 | OS sem cliente (balcão) | Salvar sem cliente e sem veículo | **Caracterizar** (o formulário aceita *Sem cliente*): grava e exibe sem quebrar nas telas de lista/detalhe/relatórios | P1 | ⬜ |
| OS-B-06 | Cliente criado na hora | Buscar cliente inexistente | **Caracterizar** se há atalho de cadastro; senão, mensagem clara | P2 | ⬜ |
| OS-B-07 | Item de cada tipo | Adicionar S1 (serviço), P1 (peça), K1 (grupo), M1 (manual) | Cada um entra com descrição, categoria, preço e custo corretos; grupo expande/agrupa; manual não tem categoria | P0 | ⬜ |
| OS-B-08 | Quantidade | Quantidade 1, 3, 10, 0, −1, decimal | 0 e negativo viram 0 (`setItemQuantity`) e o total não conta; total = preço × quantidade; decimal — **caracterizar** | P0 | ⬜ |
| OS-B-09 | Editar preço e custo do item na criação | Mudar *Venda* e *Custo* de P1 | Total, custo total e margem mudam na hora; o valor gravado é o editado, não o do catálogo | P0 | ⬜ |
| OS-B-10 | Remover item | Adicionar 3 → remover o do meio | Total e comissão recalculam; os outros itens intactos | P1 | ⬜ |
| OS-B-11 | OS sem itens | Tentar salvar com zero itens | **Caracterizar** (impede ou grava total 0); sem erro 500 | P0 | ⬜ |
| OS-B-12 | Desconto | Desconto R$ 140 em OS-REF1 | Total 1.260,00 na tela e no banco; resumo mostra o desconto | P0 | ⬜ |
| OS-B-13 | Desconto maior que o total | Desconto R$ 5.000 em OS de 1.400 | Total vai a 0 (nunca negativo) — confirmar se o formulário avisa; banco nunca grava total negativo | P0 | ⬜ |
| OS-B-14 | Imposto | Ativar imposto 5 % (ISS) | Imposto = 5 % do total já com desconto; entra na margem; gravado em `total_taxes_amount` e `selected_taxes` | P1 | ⬜ |
| OS-B-15 | Arredondamento do total | S4 ×3 (33,33) com desconto de 10 % | Total em 2 casas na tela e no banco, sem diferença de centavo | P0 | ⬜ |
| OS-B-16 | Margem estimada | OS-REF1 com desconto, responsáveis Ana+Bruno+Carla | *Margem estimada* = **356,00** (total − custo − imposto − comissão) | P0 | ⬜ |
| OS-B-17 | Datas | Entrada no passado e *Data prevista* anterior à entrada | **Caracterizar** a validação; `entry_date` padrão é hoje | P1 | ⬜ |
| OS-B-18 | Campos de texto | Defeito, diagnóstico e observações com acento, emoji, quebra de linha e 5.000 caracteres | Gravados e exibidos fielmente no detalhe e no orçamento | P2 | ⬜ |
| OS-B-19 | Criar com agendamento | Marcar *Agendamento ativo* → data, horário, prioridade | OS criada **e** agendamento criado, ligados (`appointment_id`); aparece na Agenda | P1 | ⬜ |
| OS-B-20 | Validações do agendamento | Marcar agendamento sem cliente / sem veículo / sem data | Toasts *Selecione um cliente para agendar*, *…um veículo…*, *Data do agendamento é obrigatória*; nada gravado | P1 | ⬜ |
| OS-B-21 | Produto master | Escolher um produto master | Fica vinculado (`master_product_id`) e aparece no detalhe e filtros | P2 | ⬜ |
| OS-B-22 | Cancelar o modal | Preencher tudo → *Cancelar* | Nada gravado; reabrir o modal começa limpo (sem lixo da vez anterior) | P1 | ⬜ |
| OS-B-23 | Duplo clique em *Criar OS* | Clicar duas vezes rápido | **Uma** OS só (`isSaving` trava) | P0 | ⬜ |
| OS-B-24 | Erro do servidor | Derrubar a API ao salvar | Toast *Erro ao criar OS* com a mensagem; modal continua aberto com os dados; nenhuma OS fantasma | P1 | ⬜ |
| OS-B-25 | Corpo malicioso (a partir da tela) | Interceptar a requisição e trocar `organization_id`/`created_by` | Gravado na oficina da sessão | P0 | ⬜ |
| OS-B-26 | 📱 Criar no celular | OS-B-01 em 390 px | Concluível, teclado não cobre *Criar OS*, seletores utilizáveis | P1 | ⬜ |

### OS-C — Responsáveis e comissão na criação (prévia)

A prévia do modal é calculada no navegador; o servidor recalcula ao salvar. Os dois precisam concordar.

| ID | Cenário | Passos | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-C-01 | **Ana: regra única de 10 %** | OS-REF1 → responsável Ana | Prévia *Comissão: R$ 140,00*, nota *Por regra/categoria*; popover mostra a regra; ao salvar, 140,00 em `commission_amount` e no item | P0 | ⬜ |
| OS-C-02 | **Bruno: lucro em serviço, receita em peça** | OS-REF1 → Bruno | **230,00** (S1: 210 + P1: 20); o detalhe por item mostra a regra de cada linha | P0 | ⬜ |
| OS-C-03 | **Carla: fixo por unidade, só peças** | OS-REF1 → Carla | **40,00**; S1 sem comissão | P0 | ⬜ |
| OS-C-04 | Diego sem plano | OS-REF1 → Diego | R$ 0,00 e nota *Sem comissão* | P0 | ⬜ |
| OS-C-05 | Responsável sem item elegível | Só S1 → Carla | R$ 0,00 e nota *Sem itens elegíveis* (não *Sem comissão*) | P0 | ⬜ |
| OS-C-06 | **Elisa: versão pelo mês da OS** | Entrada no mês atual vs. 2 meses atrás | 12 % no mês atual (168,00), 8 % no mês antigo (112,00); trocar a *Data de entrada* no modal **atualiza a prévia** | P0 | ⬜ |
| OS-C-07 | **Fábio: dois planos** | OS-REF1 → Fábio | **140,00**: peças pela regra fixa específica (40), resto 10 % (100) | P0 | ⬜ |
| OS-C-08 | Vários responsáveis | Ana + Bruno + Carla + Diego | Cada um com o valor da tabela §3.5; **soma** em *Comissão* do resumo; margem coerente | P0 | ⬜ |
| OS-C-09 | Desconto rateado | OS-REF1 com desconto 140 | Ana 126, Bruno 198, Carla 40, Elisa 151,20, Fábio 130 (tabela §3.5) | P0 | ⬜ |
| OS-C-10 | Imposto reduz comissão sobre lucro | OS-REF1 + imposto 5 % → Bruno | **215,00** | P1 | ⬜ |
| OS-C-11 | Arredondamento por item | S4 ×3 → Ana | **10,00** (9,999) | P0 | ⬜ |
| OS-C-12 | Lucro negativo | S5 → Bruno | **0,00**; nunca negativa | P0 | ⬜ |
| OS-C-13 | Fixo × quantidade | P3 ×10 → Carla | **200,00** | P0 | ⬜ |
| OS-C-14 | Item manual sem categoria | M1 → Ana / Bruno / Carla | Ana 10 (regra padrão pega item sem categoria); Bruno 5 (padrão); Carla 0 (sem padrão) | P0 | ⬜ |
| OS-C-15 | Mudar item recalcula a prévia | Trocar quantidade de P1 de 2 para 5 | Prévia de todos os responsáveis atualiza na hora | P1 | ⬜ |
| OS-C-16 | Remover responsável | Remover Bruno | Some a linha e o valor; total de comissão e margem recalculam | P1 | ⬜ |
| OS-C-17 | Responsável repetido | Selecionar Ana duas vezes | Toast *Responsável já selecionado*; não duplica | P1 | ⬜ |
| OS-C-18 | Todos já adicionados | Adicionar todos os funcionários e clicar *Adicionar* | Toast *Todos os responsáveis já foram adicionados* | P2 | ⬜ |
| OS-C-19 | Funcionário desligado | Funcionário com `termination_date` passado | **Caracterizar**: não aparece na busca de responsável (ou aparece sinalizado) | P1 | ⬜ |
| OS-C-20 | Prévia == salvo == detalhe | Para OS-C-08 | Os três valores iguais por funcionário e no total (regressão da divergência cliente × servidor) | P0 | ⬜ |
| OS-C-21 | Plano alterado depois da OS | Mudar a regra de Ana e **reabrir** a OS | A OS antiga mantém o valor gravado (snapshot); só vale para novas OS/edição — **caracterizar** | P0 | ⬜ |

### OS-D — Status, edição e duplicação

| ID | Cenário | Passos | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-D-01 | **Ciclo completo de status** | Orçamento → *Abrir OS* → *Iniciar* → *Concluir* | Toast *Status atualizado* a cada passo; badge e botão trocam; banco confere; ao concluir o botão de avanço some | P0 | ⬜ |
| OS-D-02 | Mesmo avanço pelo detalhe | Repetir pelo cabeçalho do detalhe | Idêntico à lista | P1 | ⬜ |
| OS-D-03 | Concluir não gera comissão paga | Concluir OS com responsável | Comissão fica **pendente de pagamento do cliente** (só libera ao receber) | P0 | ⬜ |
| OS-D-04 | Status sem botão de avanço | `waiting_for_part`, `invoiced`, `delivered`, `cancelled` | Nenhum botão de avanço; mudar `waiting_for_part` só pela edição | P1 | ⬜ |
| OS-D-05 | **Editar OS aberta** | *Editar* → trocar quantidade, desconto e responsável → *Salvar alterações* | Toast *OS atualizada com sucesso*; total, itens e comissão recalculados no detalhe e no banco; número preservado | P0 | ⬜ |
| OS-D-06 | Editar concluída ainda não paga | OS `completed` + `pending` → editar | Permitido; comissão e total reconciliados | P0 | ⬜ |
| OS-D-07 | **OS paga ou parcial não edita** | OS `paid` e `partial` | Botão *Editar* ausente; abrir o modal por manipulação da URL/estado também é recusado pelo servidor | P0 | ⬜ |
| OS-D-08 | OS invoiced/delivered/cancelled não edita | Cada status | Sem *Editar* | P1 | ⬜ |
| OS-D-09 | 🐞 Editar total de OS com sinal pago | OS aberta com sinal recebido → aumentar o total | Status e comissão liberada reconciliam (hoje não: KF-38/39) | P0 | ⬜ |
| OS-D-10 | Trocar cliente/veículo na edição | Editar | Atualiza detalhe e lista; vínculo antigo some | P1 | ⬜ |
| OS-D-11 | Editar não duplica comissão | Salvar a mesma OS 3 vezes | Um só registro de comissão por funcionário | P0 | ⬜ |
| OS-D-12 | Número na edição | Mudar para número de outra OS | Toast *Número já existe*; nada muda | P1 | ⬜ |
| OS-D-13 | **Duplicar OS** | Menu do card → duplicar | Toast *OS duplicada com sucesso*; nova OS com novo número, mesmos itens/responsáveis/desconto, status inicial e **pagamento zerado**; a original intacta | P1 | ⬜ |
| OS-D-14 | Duplicar OS paga | Duplicar OS `paid` | A cópia nasce `pending`, sem parcelas, sem comissão liberada | P0 | ⬜ |
| OS-D-15 | Exclusão de OS aberta | *Excluir OS* → confirmar | Some da lista; soft delete no banco; relatórios não a contam | P0 | ⬜ |
| OS-D-16 | Excluir OS com pagamento | OS `paid`/`partial` → *Excluir OS* | Recusa com orientação (desfazer o pagamento antes) ou reverte tudo — **caracterizar** (SER-03); saldo nunca fica errado | P0 | ⬜ |
| OS-D-17 | Cancelar OS sem pagamento | *Cancelar OS* → confirmar | Toast *OS cancelada*; badge *Cancelada*; comissão pendente removida; não entra no faturamento | P0 | ⬜ |
| OS-D-18 | Cancelar pede confirmação | *Cancelar OS* → desistir | Nada muda | P1 | ⬜ |
| OS-D-19 | OS cancelada é terminal | Tentar editar/receber/avançar | Nenhuma ação disponível | P0 | ⬜ |

### OS-E — Detalhe, orçamento e impressão

| ID | Cenário | Passos | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-E-01 | Cartões do detalhe | Abrir a OS-REF1 | Info, cliente/veículo, itens (descrição, qtd, valores), responsáveis, comissões, financeiro — todos batem com o que foi criado | P1 | ⬜ |
| OS-E-02 | Cartão de comissões | Detalhe com Ana+Bruno+Carla | Valor por funcionário e por item; total == soma; regra mostrada no popover | P0 | ⬜ |
| OS-E-03 | Cartão financeiro | OS parcialmente recebida | Total, recebido, a receber e margem corretos (sem erro de arredondamento) | P0 | ⬜ |
| OS-E-04 | Abrir pelo card (modal/slideover) | Clicar no card em desktop e mobile | Abre o detalhe certo; fechar volta à lista sem perder filtro nem posição | P1 | ⬜ |
| OS-E-05 | Detalhe de OS de outra oficina | URL/ação com id da oficina B logado na A | 404/forbidden, sem vazar nada | P0 | ⬜ |
| OS-E-06 | **Orçamento: pré-visualização** | *Orçamento* | Documento com dados da oficina, cliente, veículo, itens e total corretos | P1 | ⬜ |
| OS-E-07 | Orçamento: PDF e impressão | *Baixar PDF* e *Imprimir* | PDF baixa com número e total corretos; impressão abre sem erro | P1 | ⬜ |
| OS-E-08 | Orçamento com desconto e imposto | OS com ambos | Subtotal, desconto e imposto exibidos; **não mostra comissão nem custo** (dado interno) | P0 | ⬜ |
| OS-E-09 | Orçamento sem cliente | OS de balcão | Gera sem quebrar | P2 | ⬜ |

### OS-F — Receber pagamento (PaymentModal)

Conta nova por teste; a invariante de caixa fecha todos eles (**P0**).

| ID | Cenário | Passos | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-F-01 | **À vista (PIX)** | OS `completed` → *Receber* → PIX, Conta Caixa, valor total → *Registrar pagamento* | Toast *Pagamento registrado com sucesso*; badge *Paga*; saldo +total (tela de contas e banco); 1 linha de extrato; 1 transação `income`; invariante de caixa | P0 | 🟡 |
| OS-F-02 | Cada forma de pagamento | Dinheiro, Pix, Transferência, Boleto, Cheque, Cartão débito/crédito | Grava a forma certa; cartão exige/oferece maquininha | P1 | ⬜ |
| OS-F-03 | **Parcelado 3×** (1ª paga) | *Número de parcelas* = 3 → 1ª *Pago*, demais *Pendente* | OS *Parcial*; 3 parcelas na tela e no banco com status certos; saldo só da paga | P0 | 🟡 |
| OS-F-04 | Parcelas com centavos | Total 100,00 em 3× | Parcelas somam **exatamente** 100,00 (33,34 + 33,33 + 33,33 ou equivalente); sem sobra | P0 | ⬜ |
| OS-F-05 | Soma ≠ saldo da OS | Editar uma linha até a soma divergir | Toast *O total das linhas precisa bater com o saldo restante da OS*; nada gravado (e 400 se burlar) | P0 | 🟡 |
| OS-F-06 | Sem conta bancária | Linha paga sem conta | Toast *Selecione a conta bancária em todas as linhas* | P0 | ⬜ |
| OS-F-07 | Sem forma de receber | Nenhuma linha | Toast *Defina ao menos uma forma de receber o pagamento* | P1 | ⬜ |
| OS-F-08 | Mais de uma forma na mesma OS | 50 % PIX + 50 % Dinheiro, contas diferentes | Dois lançamentos, cada um na sua conta; saldos certos | P0 | ⬜ |
| OS-F-09 | Entrada + restante | *Receber entrada* com *Valor da entrada* | Entrada paga, restante em parcelas; status *Parcial* | P0 | ⬜ |
| OS-F-10 | Adiantamento maior que o total | Sinal prévio > valor final | Toast *O adiantamento recebido é maior que o valor final da OS* | P0 | ⬜ |
| OS-F-11 | **Maquininha e taxa** | Cartão crédito com maquininha 3 % | Taxa registrada (`terminal_fee_amount`); líquido correto; saldo recebe o valor definido pela regra (**caracterizar** bruto × líquido) | P1 | ⬜ |
| OS-F-12 | Data do pagamento | Data no passado | Lançamento/extrato com a data escolhida; relatório de caixa no período certo | P1 | ⬜ |
| OS-F-13 | Receber OS já paga | Abrir uma OS `paid` | Sem botão *Receber*; chamada direta recusada (409) | P0 | 🟡 |
| OS-F-14 | Receber OS aberta (não concluída) | OS `open` | Recusa/oculta o botão (409 no servidor) | P0 | 🟡 |
| OS-F-15 | **Duplo clique em Registrar** | Clique duplo | **Um** recebimento só; saldo e extrato uma vez | P0 | ⬜ |
| OS-F-16 | Conta de outra oficina | Seletor de conta | Só contas da própria oficina; id forçado de outra é recusado | P0 | 🟡 |
| OS-F-17 | Erro de rede ao confirmar | Derrubar a API | Toast *Erro ao registrar pagamento*; modal fica; reenviar não duplica | P1 | ⬜ |
| OS-F-18 | 📱 Receber no celular | OS-F-01 em 390 px | Modal cabe; *Registrar pagamento* sempre acessível | P0 | ⬜ |

### OS-G — Sinal, avulso e parcelas

| ID | Cenário | Passos | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-G-01 | **Receber sinal** | OS aberta → *Receber sinal* → valor, conta, forma | Toast *Sinal registrado com sucesso*; parcela de sinal criada; saldo +sinal; OS `partial` | P0 | 🟡 |
| OS-G-02 | Sinal sem valor ou sem conta | Valor 0 / sem conta | Toasts *Informe um valor de sinal maior que zero* / *Selecione a conta bancária* | P1 | ⬜ |
| OS-G-03 | Sinal maior que o total | Sinal > total da OS | **Caracterizar** (recusa ou aceita); saldo nunca diverge | P0 | ⬜ |
| OS-G-04 | Sinal e depois plano | Sinal 300 → concluir → *Receber* o restante | Plano considera o sinal; soma fecha o total; `paid` só ao quitar | P0 | ⬜ |
| OS-G-05 | **Receber avulso** | OS paga → *Receber avulso* | Toast *Recebimento registrado com sucesso*; parcela `extra` paga; saldo +valor | P1 | 🟡 |
| OS-G-06 | Avulso sem valor / sem conta | Campos vazios | *Informe um valor maior que zero* / *Selecione a conta bancária* | P1 | ⬜ |
| OS-G-07 | 🐞 Avulso menor que o total deixa a OS "paga" | Avulso de R$ 1 numa OS de 1.000 sem plano | OS **não** deve ficar quitada (hoje fica: KF-31) | P0 | ⬜ |
| OS-G-08 | **Pagar parcela inteira** | Parcela pendente → *Pagar* → *Confirmar* | Toast *Pagamento registrado com sucesso*; parcela `paid`; saldo +valor; OS atualiza para `partial`/`paid` | P0 | 🟡 |
| OS-G-09 | **Pagar em partes** | *Valor recebido agora* = 40, depois 60 | Parcela `partial` e depois `paid`; botão vira *Receber restante*; valor esperado × recebido corretos | P0 | 🟡 |
| OS-G-10 | Pagar acima do restante | Valor maior que o saldo da parcela | Bloqueado na tela; nada gravado | P0 | 🟡 |
| OS-G-11 | Pagar com conta e forma diferentes | Cada parcela por uma conta | Cada saldo recebe só o seu | P0 | ⬜ |
| OS-G-12 | Editar parcela pendente | *Editar parcela* → vencimento e valor | Toast *Parcela atualizada*; soma do plano continua fechando o total — **caracterizar** | P1 | ⬜ |
| OS-G-13 | Editar parcela paga | Tentar | Recusado; valor/data de parcela paga não muda | P0 | ⬜ |
| OS-G-14 | **Excluir parcela paga** | *Excluir parcela* + motivo | Toast *Parcela excluída*; saldo devolvido, extrato estornado, comissão reajustada; número da parcela reaproveitado depois | P0 | 🟡 |
| OS-G-15 | Excluir exige motivo | Sem motivo | Não confirma | P1 | ⬜ |
| OS-G-16 | **Cancelar recebimento da parcela** | *Cancelar recebimento* | Toast *Recebimento cancelado*; parcela volta a pendente; saldo volta | P0 | 🟡 |
| OS-G-17 | Parcela vencida | Vencimento no passado | Marcada como vencida na tela; aparece em *Devedores* | P1 | ⬜ |

### OS-H — Desfazer, cancelar e estornar

| ID | Cenário | Passos | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-H-01 | **Cancelar pagamento** | OS paga → *Cancelar pagamento* | Saldo volta ao inicial; extrato estornado; transações marcadas; OS volta a `pending`; comissão volta a pendente | P0 | 🟡 |
| OS-H-02 | Ciclo receber → desfazer → receber | Repetir 2× | Saldo final = saldo inicial + total (uma vez); sem resíduo de extrato | P0 | 🟡 |
| OS-H-03 | Desfazer com várias parcelas na mesma conta | 3 parcelas pagas | Saldo correto (regressão KF-19) | P0 | 🟡 |
| OS-H-04 | Desfazer com contas diferentes | Parcelas em 2 contas | Cada conta devolve o seu valor | P0 | ⬜ |
| OS-H-05 | Cancelar OS com pagamento | *Cancelar OS* numa OS paga | Recusa orientando desfazer antes; depois de desfazer, cancela | P0 | 🟡 |
| OS-H-06 | 🐞 Cancelar OS apaga comissão **paga** | Pagar a comissão e cancelar a OS | Comissão paga **nunca** é apagada (hoje é: KF-40) | P0 | ⬜ |
| OS-H-07 | OS cancelada fora dos relatórios | Cancelar e abrir faturamento/devedores | Não entra | P0 | 🟡 |
| OS-H-08 | Estorno com comissão já paga | Desfazer pagamento de OS cuja comissão foi paga | Comissão paga permanece; aviso/regra clara — **caracterizar** | P0 | ⬜ |

### OS-I — Comissão liberada e paga (do recebimento ao relatório)

| ID | Cenário | Passos | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-I-01 | **Recebimento integral libera tudo** | OS-REF1 c/ desconto, Ana+Bruno+Carla → receber 1.260 | Registros: Ana 126, Bruno 198, Carla 40, status "pendente de pagamento ao funcionário"; cartão *Comissões* e relatório conferem | P0 | ⬜ |
| OS-I-02 | **Liberação proporcional** | Receber 630 (50 %) | Ana 63, Bruno 99, Carla 20; ao quitar, 126/198/40 | P0 | ⬜ |
| OS-I-03 | 🐞 Pagamento parcial de parcela | Pagar 40 de uma parcela de 100 | A parte recebida deve entrar na liberação (hoje não: KF-24) | P0 | ⬜ |
| OS-I-04 | **Liberar 100 % agora** | Marcar *Liberar 100% da comissão* com 30 % de entrada | Comissão inteira liberada já; opção irreversível (não aparece de novo) | P0 | ⬜ |
| OS-I-05 | Comissão por funcionário na mesma OS | Ana, Bruno, Carla, Diego, Elisa, Fábio na OS | Cada um com o seu valor; Diego sem registro | P0 | ⬜ |
| OS-I-06 | Relatório de comissões | Abrir *Comissões* no período | Cada funcionário com o total das OS; soma bate com os registros; filtro por funcionário e por status | P0 | ⬜ |
| OS-I-07 | **Pagar comissões em lote** | Selecionar registros → pagar | Registros `paid`; despesa em *Salários*; saldo cai; pagar de novo → recusado | P0 | 🟡 |
| OS-I-08 | Comissão paga não some | Desfazer/cancelar a OS depois de pagar a comissão | Registro pago permanece (I3) | P0 | ⬜ |
| OS-I-09 | Funcionário só vê a própria | Logar como `staff` com papel limitado | Só as suas comissões; valores de colegas ocultos | P0 | ⬜ |
| OS-I-10 | Mesma OS em meses diferentes | Duas OS, uma por mês de vigência da Elisa | Cada uma com a taxa da versão do seu mês (8 % / 12 %) | P0 | ⬜ |
| OS-I-11 | Override manual de comissão | *Regras* → aplicar e remover override | Valor muda e volta; log de auditoria visível | P1 | ⬜ |
| OS-I-12 | Recalcular comissões (`generate-commissions`) | Ação manual na OS | Recalcula sem apagar comissão paga nem comissão de quem ainda tem regra (regressão KF-36) | P0 | ⬜ |

### OS-J — A OS refletida nos demais módulos

| ID | Cenário | Passos | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-J-01 | **Dashboard e visão geral** | Receber uma OS e abrir o dashboard e *Relatórios → Visão geral* | Mesmo faturamento nos dois; sobe exatamente o total | P0 | 🟡 |
| OS-J-02 | Devedores | OS concluída sem pagamento → ver *Devedores*; receber → sai | Total devido sobe/desce; sinal descontado | P1 | 🟡 |
| OS-J-03 | Lucro por OS | Abrir *Lucro* | Receita, custo, comissão e lucro da OS-REF1 batem com a tabela §3.5 | P0 | ⬜ |
| OS-J-04 | Fluxo de caixa | Relatório de caixa no dia | Entradas do dia = recebimentos feitos | P1 | 🟡 |
| OS-J-05 | Tela de contas | Abrir *Contas* | Saldo e extrato da conta recebem a OS com número e descrição | P0 | ⬜ |
| OS-J-06 | Financeiro | Abrir lançamentos | Receita ligada à OS; filtro por status/conta; clicar leva à OS | P1 | ⬜ |
| OS-J-07 | Relatório de vendas por item | Itens da OS-REF1 | Quantidade e valor de S1 e P1 | P1 | ⬜ |
| OS-J-08 | Cliente e veículo | Histórico do cliente C1 | A OS aparece no histórico; filtro da lista por veículo V1 acha só ela | P1 | ⬜ |
| OS-J-09 | Agenda | OS criada com agendamento | Evento na Agenda no dia/hora; abrir leva à OS | P2 | ⬜ |
| OS-J-10 | **NFS-e a partir da OS** | OS paga em oficina plano `fiscal` → *Emitir NFS-e* (Focus mockada) | Nota processando → autorizada; erro da API tratado; **bloqueado fora do plano** | P1 | ⬜ |

### OS-K — Permissões e isolamento (pela tela)

| ID | Cenário | Passos | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-K-01 | Sem `orders.create` | `staff` sem a permissão | Sem botão *Nova OS* | P0 | ⬜ |
| OS-K-02 | Sem `orders.update` | `staff` sem a permissão | Sem *Editar* | P0 | ⬜ |
| OS-K-03 | Sem `orders.cancel` / `orders.delete` | `staff` sem as permissões | Sem *Cancelar OS* / *Excluir OS* | P0 | ⬜ |
| OS-K-04 | Sem `orders.read` | Abrir `/app/service-orders` | Redireciona para `/app/forbidden`; lista não carrega | P0 | ⬜ |
| OS-K-05 | Sem permissão financeira | Sem `financial.*` | Sem *Receber*, *Receber sinal*, *Receber avulso*, *Excluir parcela* | P0 | ⬜ |
| OS-K-06 | 🐞 Ação direta sem permissão | Chamar a rota de pagamento sem o papel | Deve devolver 403 (hoje aceita: KF-09) | P0 | ⬜ |
| OS-K-07 | Papel muda e a tela reflete | Admin concede `orders.update` ao papel → `staff` recarrega | *Editar* aparece sem precisar sair | P0 | ⬜ |
| OS-K-08 | **Isolamento entre oficinas** | Oficina B tenta ver/editar/receber/cancelar OS da A (por URL e API) | Nada aparece nem muda; a OS da A intacta | P0 | 🟡 |
| OS-K-09 | Seletores só da própria oficina | Cliente, veículo, produto, funcionário e conta no modal | Só opções da sua oficina | P0 | ⬜ |
| OS-K-10 | Funcionário desligado | `termination_date` no passado | Barrado na próxima navegação (403/login) | P0 | ⬜ |
| OS-K-11 | Sessão expirada no meio | Invalidar o token com o modal aberto → salvar | Mensagem/redirecionamento claro, sem perder o que foi digitado quando possível | P1 | ⬜ |

### OS-L — Volume e desempenho (seed demo)

| ID | Cenário | Passos | Esperado | Prio. | Estado |
|---|---|---|---|---|---|
| OS-L-01 | Lista carrega rápido | Abrir a lista com 1.265 OS | Primeira página em tempo aceitável (limite a definir); sem erro | P2 | ⬜ |
| OS-L-02 | Busca e filtros em base grande | Buscar por número, cliente e placa reais do seed | Resultado correto e rápido | P1 | ⬜ |
| OS-L-03 | Detalhe de OS antiga com sujeira | Abrir 20 OS aleatórias (todos os status) | Nenhuma quebra de tela, valor `NaN` ou item sem categoria | P1 | ⬜ |
| OS-L-04 | Relatórios com volume | Visão geral e comissões de um mês cheio | Carregam; total do dashboard == visão geral | P1 | ⬜ |
| OS-L-05 | Exportar CSV grande | Exportar sem filtro | Arquivo gera; número de linhas == total da lista | P2 | ⬜ |

---

## 5. Resumo

| Grupo | Cenários | P0 | Já cobertos só por API (🟡) | Bugs conhecidos (🐞) |
|---|---:|---:|---:|---:|
| A Lista/filtros | 16 | 3 | 0 | 0 |
| B Criar | 26 | 13 | 0 | 0 |
| C Comissão na criação | 21 | 15 | 0 | 0 |
| D Status/edição | 19 | 12 | 0 | 1 |
| E Detalhe/orçamento | 9 | 4 | 0 | 0 |
| F Receber | 18 | 13 | 6 | 0 |
| G Sinal/avulso/parcelas | 17 | 11 | 7 | 1 |
| H Desfazer/cancelar | 8 | 8 | 5 | 1 |
| I Comissão liberada/paga | 12 | 11 | 1 | 1 |
| J Outros módulos | 10 | 3 | 3 | 0 |
| K Permissões/isolamento | 11 | 10 | 1 | 1 |
| L Volume (seed demo) | 5 | 0 | 0 | 0 |
| **Total** | **172** | **103** | **23** | **5** |

## 6. Ordem de implementação

1. **Base:** `catalog.ts` (massa §3), page objects e `db.ts`. Sem isso nenhum cenário numérico fecha.
2. **Núcleo do dinheiro (F, G, H):** refazer pela tela o que `money-flows.e2e.ts` já prova por API. É o maior risco e o asserto de banco já existe.
3. **Comissão (C, I):** tabela-verdade §3.5, prévia × salvo × detalhe. É onde moram as reclamações de "comissão errada".
4. **Criar, status e edição (B, D, E).**
5. **Permissões e isolamento (K).**
6. **Lista, filtros e volume (A, L)** e **relatórios (J)**.

Cenários que descobrirem comportamento diferente do esperado viram `test.fail()` com `KF-nn` em [known-failures.md](./known-failures.md), e não são "ajustados" para passar.

## 7. O que **não** é E2E (já tem camada mais barata)

- A conta da comissão em si (percentual, fixo, base, versão por mês, arredondamento) → **L1**, `employee-commission-engine`. O E2E só confere que a tela chama e mostra o que o motor calcula.
- Soma de parcelas, estorno e idempotência no servidor → **L2/L3** (`tests/unit`, `tests/api`).
- Numeração concorrente sem colisão → **L3** com Postgres real (RPC `next_service_order_number`).
