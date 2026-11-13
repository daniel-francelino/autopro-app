# Review de layout: Configurações > Permissões (papéis)

Público: dev frontend, product owner. Status: proposta. Data: 2026-11-13.
Método: análise inicial exclusiva de 4 screenshots (sem navegador). Depois, validação pontual no código e nas migrations, e respostas do stakeholder (seção 6). O que ainda depende de navegador está marcado como **hipótese**.

**Atualização 2026-11-13:** itens F2, F13 e as perguntas abertas foram resolvidos com evidência de código e decisões do stakeholder. Ver seção 6.

Imagens: (1) lista `/app/settings/roles`; (2) detalhe do papel "Anderson", header + "Dados do papel"; (3) seção "Permissões" com abas e checkboxes; (4) "Usuários vinculados" + rodapé.

## 1. Findings (por severidade)

Legenda: **Quebrado** = defeito objetivo, bloqueia merge; **Alto/Médio/Baixo** = melhoria priorizada.

### Quebrado

**F1. Rótulos dos cards de métricas transbordam/quebram (img 2).** "USUÁRIOS VINCULADOS" vaza o card (o "S" encosta/ultrapassa a borda), "PERMISSÕES LIBERADAS" idem, "TOTAL DE AÇÕES" quebra em 3 linhas e desalinha o valor (107 fica mais baixo que 1 e 31). Uppercase + tracking largo + cards estreitos (~85 px). Defeito visual claro.

**F2. Abas repetidas "Outros" sem significado (img 3).** Há 5 chips "Outros" (contagens 4, 2, 2, 4, 2) e nenhuma forma de saber o que cada um contém. Usuário precisa clicar em cada um para descobrir. Viola o princípio básico de rótulo único e descritivo. **Causa confirmada (ver seção 6.1):** o campo `resource` das ações não tem rótulo em `formatResourceLabel` e cai no fallback "Outros".

### Alto

**F3. Padrão de ~25 chips-abas em 6 linhas é o padrão errado para 107 ações (img 3).** As abas ocupam ~330 px de altura, empurram a lista para baixo da dobra, quebram linha sem ordem (não é alfabética: Agendamentos, Autorizações, Contas bancárias, Bônus, Comissões, Consultas, Clientes, Funcionários, Financeiro, Estoque, Outros, Ordens de serviço...) e o usuário só vê 4 ações por vez. Impossível comparar módulos, ver o quadro geral ou fazer "marcar tudo". Auditar um papel exige ~25 cliques. Contrasta com o texto "agrupadas por abas para deixar a edição mais compacta": o resultado é o oposto.

**F4. Sem visão geral nem busca de permissões (img 3).** Não há resumo por módulo (ex.: "3/4"), busca por nome da ação, filtro "só marcadas" nem "marcar/desmarcar todas do módulo". As contagens nos chips mostram o total de ações do módulo, não quantas estão liberadas (o "31 liberadas" do header não se conecta a nada na lista).

**F5. Barra de salvar não é sticky e não indica alterações pendentes (img 4).** "Voltar / Salvar alterações" está no fim de uma página muito longa (header + dados + 6 linhas de chips + lista + usuários). Quem altera uma permissão no topo precisa rolar até o fim. Sem indicador de "alterações não salvas" visível nas imagens; "Voltar" pode descartar mudanças sem aviso (**hipótese**: não há guarda de saída).

**F6. Lixeira vermelha sem proteção aparente e sem rótulo (img 1).** O ícone de excluir fica colado ao lápis (~28 px de distância), cor vermelha permanente em todas as linhas, sem tooltip visível. Não se sabe se há confirmação (**hipótese**; validar). Risco real: excluir papel pode deixar usuários sem acesso. Também no desvincular usuário (img 4, ícone vermelho sem texto) acima do 'Leal'.

### Médio

**F7. Checkbox + badge "Permitido" + ícone + descrição duplicada (img 3).** Cada linha repete 4 vezes a mesma informação: checkbox marcado, badge verde "Permitido", ícone roxo do módulo (igual em todas as linhas), título "Atualizar Agendamentos" e subtítulo idêntico "Atualizar Agendamentos". O badge "Permitido" é redundante com o checkbox (e minúsculo, texto ~9 px, baixo contraste verde sobre verde claro). Linhas de ~65 px para 1 bit de informação. O ícone repetido não agrega valor (o módulo já está no contexto da aba/seção).

**F8. Tipo de checkbox: estado "negado" invisível (img 3).** Só aparecem marcados; não dá para saber o aspecto de uma ação não liberada (hipótese: sem badge, ou badge "Negado"). Marcado preto sobre fundo claro é legível, mas o alvo é ~16 px (abaixo de 44 px de toque; a linha inteira ser clicável resolveria; **validar** se o label é clicável).

**F9. Hierarquia confusa no header do papel (img 2).** Card com gradiente + ícone + título 30 px + texto instrucional + 3 mini-cards em cinza/branco. Texto "Ajuste os dados principais... marque nas abas quais ações ficam liberadas" é instrução genérica que ocupa espaço em toda visita. Estilo de "landing" (gradiente roxo/verde) em tela operacional; os mini-cards são decorativos (ícones coloridos diferentes sem significado) e ocupam ~200 px de altura antes de qualquer campo editável.

**F10. Papéis Sistema vs Personalizado pouco distintos (img 1, 2).** "Sistema" é um badge de ~8 px em cinza, quase ilegível; papéis personalizados não têm badge. Na lista, a diferença real é a presença de lápis e lixeira, sem explicação ("por que Administrador não tem editar?"). No detalhe, "Personalizado" aparece como badge pequeno. Não há texto/tooltip explicando que papéis de sistema são somente leitura (**validar regra**).

**F11. Lista de papéis com descrições duplicadas e vazias (img 1).** "Anderson" e "Funcionário" têm exatamente a mesma descrição ("Acesso limitado apenas para visualizar e executar tarefas operacionais básicas"); isso parece cópia da descrição do Funcionário (dado, não layout). "Marcineia" mostra "-" (estado vazio ruim). A lista não mostra nº de usuários nem nº de permissões, os dados que realmente diferenciam os papéis.

**F12. Lista de papéis: layout pouco denso e card em card (img 1).** Container cinza com cards brancos dentro, cada um ~65 px, só 5 itens e metade da tela vazia. Ações (olho, lápis, lixeira) são ícones sem texto; "olho" para papéis de sistema e para personalizados faz ação equivalente ao lápis? (Redundância provável, **hipótese**). Um `UTable` com colunas seria mais útil (papel, tipo, usuários, permissões, ações).

### Baixo

**F13. Usuários vinculados em card isolado dentro de grade (img 4).** Um card de usuário de ~235 px de largura com nome "Leal", badge "Ativo" minúsculo, e-mail e "Funcionário: ANDERSON DOS SANTOS" em caixa alta (inconsistente com o restante). Seletor + botão "+" sem rótulo textual (botão ícone sem texto visível; acessibilidade: precisa de `aria-label`, **hipótese**). **Confirmado no código:** o vínculo é imediato (ver seção 6.3), mas o rodapé "Salvar alterações" sugere o contrário. Inconsistência a resolver.

**F14. Tipografia e contraste (todas).** Muitos textos de 9 a 11 px (badges "Sistema", "Permitido", "Ativo", contagens nos chips, descrições secundárias) em cinza claro: provável contraste abaixo de 4,5:1 (**estimativa visual; medir**). Chips com borda cinza muito clara.

**F15. Espaçamento e largura (img 1, 2).** Conteúdo centrado em ~830 px com muito respiro lateral e grande espaço vazio acima do título (img 2: ~90 px até o header). Desperdício em tela densa. Duas camadas de scroll visíveis (barra roxa à direita) são menores, só observação.

**F16. Navegação duplicada.** Tabs de Configurações no topo e submenu de Configurações na sidebar mostram os mesmos 6 itens (img 1 a 4). Padrão do app (não específico desta tela); não mexer aqui. Na img 2/3/4 a aba "Permissões" não aparece como ativa no topo (só na lista, img 1): provável defeito de estado ativo na rota de detalhe (**hipótese**; validar).

### Responsividade provável (hipóteses, sem screenshot mobile)
- Cards de métricas já estouram em ~1330 px; em 360 px o problema piora (F1).
- Chips: quebram linha, em mobile seriam 12+ linhas.
- Ícones de ação da lista (28 px de espaçamento) abaixo de 44 px de alvo.
- Rodapé não sticky em mobile: salvar fica muito distante.

## 2. Layout-alvo

Princípios: dado antes de decoração; um módulo = uma seção; alterações visíveis; sem inventar permissões nem regras.

### 2.1 Lista de papéis

```
Configurações > Permissões
-----------------------------------------------------------------
Papéis e permissões                              [ + Novo papel ]
Gerencie os perfis da equipe e o acesso de cada um.

[ Buscar papel... ]                      (opcional, se > ~10 papéis)

| Papel            | Tipo         | Usuários | Permissões | Ações |
|------------------|--------------|---------:|-----------:|-------|
| Administrador    | [Sistema]    |        2 |   107/107  | [Ver] |
|  Acesso total... |                                                |
| Anderson         | Personalizado|        1 |    31/107  | [Editar] [⋯] |
| Funcionário      | [Sistema]    |        3 |   ../107   | [Ver] |
| Marcineia        | Personalizado|        0 |    ../107  | [Editar] [⋯] |
|  Sem descrição   |                                                |
-----------------------------------------------------------------
[⋯] menu: Duplicar? (fora do escopo se não existir)  |  Excluir...
Excluir -> UModal de confirmação:
 "Excluir o papel 'Marcineia'? N usuários vinculados..." [Cancelar][Excluir]
```

Componentes: `UTable` (desktop) com `UBadge` (`color="neutral" variant="subtle"` para Sistema; `variant="outline"` para Personalizado), `UButton` com texto "Editar"/"Ver", `UDropdownMenu` para excluir, `UModal` de confirmação, `UTooltip` nos ícones, `UEmpty`/texto "Sem descrição" no lugar de "-". Em mobile (<640 px): lista de cards compactos (nome, badges, "N usuários · N permissões", botão Editar/menu) com alvos >= 44 px. Nº de usuários e permissões só se a API/listagem já devolve (**validar**; senão, omitir colunas).

### 2.2 Editor de papel

```
< Permissões / Anderson  [Personalizado]
-----------------------------------------------------------------
Anderson                              31 de 107 permissões · 1 usuário
(sem gradiente; resumo em texto/UBadge, não em cards)

+ Dados do papel ----------------------------------------------+
| Nome *  [Anderson______________]                              |
| Descrição [__________________________________________]      |
+--------------------------------------------------------------+

Permissões                     [🔎 Buscar ação...]  [ ] Só marcadas
31 de 107 selecionadas

+-- Sidebar/Lista de módulos ---+--- Ações do módulo ------------+
| Agendamentos        4/4       | Agendamentos  [Marcar todas]   |
| Autorizações        0/5       |  [x] Atualizar                 |
| Bônus               0/4       |  [x] Criar                     |
| Clientes            2/4       |  [x] Excluir                   |
| ... (ordem alfabética)        |  [x] Visualizar                |
+-------------------------------+--------------------------------+
Opção B (mais simples, recomendada para mobile): UAccordion com
um item por módulo: "Agendamentos  4/4  [Marcar todas]", multi-abrir.

+ Usuários vinculados (1) -------------------------------------+
| [USelectMenu Selecione usuário...] [Vincular]                 |
| Leal · lealnh9@gmail.com · Ativo · Func.: Anderson dos Santos [Desvincular] |
+--------------------------------------------------------------+

==== Barra sticky ================================================
 ● Alterações não salvas (3)        [Descartar]  [Salvar alterações]
```

Componentes Nuxt UI 4:
- Módulos: `UAccordion` (type multiple) ou `UNavigationMenu` vertical + painel (desktop >= lg) e `UAccordion` em mobile. Evitar `UTabs` para 25 itens.
- Cada ação: `UCheckbox` com `label` (nome curto) e `description` somente quando diferente do rótulo; linha inteira clicável; densa (~40 px desktop, 44 px mobile). Sem badge "Permitido", sem ícone por linha.
- "Marcar todas do módulo": `UCheckbox` indeterminado no cabeçalho do módulo ou `UButton variant="link"`.
- Busca: `UInput` com ícone, filtrando ações e expandindo módulos com resultado; `USwitch`/`UCheckbox` "Só marcadas".
- Resumo: `UBadge` "31/107" no topo e "n/m" por módulo (em vez da contagem total atual).
- Barra de salvar: container `sticky bottom-0` com `UButton` (primary) e "Descartar" (`variant="ghost"`); aparece/destaca quando há diferença (dirty). Guarda de saída com `UModal` se houver alterações (**comportamento novo: confirmar com PO**).
- Papéis de sistema: formulário e checkboxes `disabled` com `UAlert` neutro "Papéis de sistema não podem ser alterados" (somente se a regra existir; **validar**).
- Header: remover gradiente e mini-cards; usar `h1` + resumo em linha; manter nome do papel e badge de tipo.
- Nomes dos módulos: renomear "Outros" por nome real (dado/mapeamento: ver abertas) e ordenar alfabeticamente.

## 3. Passos sugeridos (ordem por risco)

1. Corrigir F1: cards de métricas (sem uppercase largo, rótulos curtos "Usuários", "Liberadas", "Total", `min-w-0`, `truncate`/wrap controlado) ou trocar por resumo em linha. Risco baixo.
2. Limpar linha de permissão (F7): remover badge "Permitido", ícone repetido e descrição duplicada. Risco baixo.
3. Barra sticky com estado de alteração (F5). Risco baixo/médio.
4. Substituir abas por acordeão com "n/m", "marcar todas", busca (F3, F4) e ordenar. Risco médio; comportamento do payload deve ficar idêntico.
5. Nomear grupos "Outros" (F2): adicionar 5 rótulos/ícones em `useRoleResources.ts` (seção 6.1). Risco baixo; pode ser feito primeiro e isolado.
6. Lista em tabela, confirmação de exclusão, rótulos/tooltips (F6, F10, F11, F12). Médio.
7. Usuários vinculados (F13) e acessibilidade geral (F14).

## 4. Critérios de aceitação

- Nenhum rótulo de métrica quebra no meio da palavra nem vaza o card, de 360 a 1440 px.
- Nenhum módulo aparece com o rótulo "Outros" repetido; cada grupo tem nome único; lista em ordem alfabética (pt-BR).
- É possível ver, sem trocar de aba, quantas ações de cada módulo estão liberadas (n/m) e o total (31/107).
- Há "marcar/desmarcar todas" por módulo e busca por ação.
- Cada ação mostra um único rótulo e um checkbox; clicar no texto alterna o checkbox; alvo >= 44 px em toque.
- Salvar permanece visível durante o scroll; estado "alterações não salvas" visível; sair com alterações pede confirmação.
- Excluir papel e desvincular usuário exigem confirmação com consequência descrita; ícones têm rótulo acessível/tooltip.
- Papel de sistema se distingue de personalizado com texto legível e a razão da ausência de edição é clara.
- Contraste >= 4,5:1 em badges e textos secundários; foco visível; sem scroll horizontal em 360 px.
- Mesmos gates `workshop.can(ActionCode.X)`, mesmas chamadas de API e mesmo payload de salvar.

## 5. Perguntas abertas / validar no código ou navegador

1. De onde vêm os 5 grupos "Outros" (prefixo de código de ação sem mapeamento?) e qual nome real cada um deve ter. Decisão de produto/negócio.
2. Papéis de sistema são realmente somente leitura? O "olho" abre o mesmo editor em modo leitura?
3. Existe confirmação ao excluir papel? O que acontece com usuários vinculados?
4. Vincular/desvincular usuário é imediato ou só no "Salvar alterações"?
5. A listagem retorna contagem de usuários e permissões (para a nova tabela)?
6. Aba "Permissões" some como ativa no detalhe (img 2 a 4): defeito de rota ativa?
7. Medir contraste real e tamanho de alvo no navegador; testar 360/768/1280 px (`design-review`).
8. Conferir se "Anderson" ter a mesma descrição do Funcionário é dado a corrigir (não layout).
9. Guarda de saída e botão "Descartar" são comportamento novo: aprovar com o PO. **Resolvida: aprovado (seção 6.4).**

Status das perguntas: 1, 2, 4 e 9 resolvidas (seção 6). Seguem abertas: 3, 5, 6, 7 e 8.

## 6. Resoluções (2026-11-13)

### 6.1 Origem dos grupos "Outros" (pergunta 1, F2)

Evidência: `app/composables/useRoleResources.ts` (`formatResourceLabel`, fallback na linha 95) compara o `resource` de cada ação, vindo da tabela `actions`, com 23 tipos fixos. Cada valor sem correspondência vira uma aba "Outros" própria. Hipótese do stakeholder (faltam mapeamentos) confirmada.

Valores de `resource` presentes nas migrations (`supabase/migrations`) sem mapeamento, que coincidem com as contagens 4, 2, 2, 4, 2 da imagem 3:

| `resource` | Ações | Rótulo sugerido (pt-BR, a confirmar) |
|---|---:|---|
| `members` | 4 | Membros |
| `organization` | 2 | Organização |
| `payment_machines` | 2 | Maquininhas |
| `returns` | 4 | Devoluções |
| `subscription` | 2 | Assinatura |

Observações:
- Rótulos e ícones são sugestão; confirmar nomes com o stakeholder. Não inventar regra de negócio.
- A contagem por `resource` foi extraída das migrations; o banco real pode divergir. Conferir contra a tabela `actions` antes de fechar.
- Correção definitiva: além de mapear, o fallback deve exibir o valor bruto do `resource` (ex.: "Outros (xyz)") para nenhum grupo ficar anônimo e quebrar de novo quando surgir um novo recurso.
- `getResourceIcon` tem o mesmo mapeamento incompleto (cai em `i-lucide-folder`); atualizar junto.

### 6.2 Papéis de sistema (pergunta 2, F10)

Decisão do stakeholder: papéis de sistema são somente leitura. O admin da organização pode criar papéis próprios.
Impacto: editor de papel de sistema abre em modo leitura (formulário e checkboxes `disabled`) com texto explicando o motivo; papel personalizado é editável.

### 6.3 Vínculo de usuário (pergunta 4, F13)

Evidência: `app/pages/app/settings/roles/[id].vue`, funções `addUserLink`, `removeUserLink` e `updateUserRoleLink` (linhas ~285-335) chamam `/api/users/update-fields` no clique, sem depender de `saveRole`. O vínculo é imediato.
Problema: "Salvar alterações" cobre só dados e permissões; o usuário pode achar que o vínculo também espera o botão.
Decisão pendente do stakeholder: (a) manter imediato e avisar no texto da seção + toast de confirmação, ou (b) tornar parte do "Salvar" (comportamento novo, mais complexo). Recomendação: (a). Em ambos os casos, desvincular exige confirmação.

### 6.4 Guarda de saída e "Descartar" (pergunta 9, F5)

Decisão do stakeholder: aceitos. Escopo: o estado "alterações não salvas" e a guarda de saída cobrem apenas dados do papel e permissões. Vínculo de usuário não entra, pois é imediato (6.3).

### 6.5 Critérios de aceitação adicionais

- Nenhum grupo aparece como "Outros" anônimo; os 5 `resource` da tabela 6.1 têm nome e ícone próprios.
- Papel de sistema abre em somente leitura com explicação; papel personalizado é editável.
- A seção "Usuários vinculados" informa que o vínculo é aplicado na hora e confirma o resultado.
- Sair da tela com alterações em dados ou permissões pede confirmação; "Descartar" restaura o estado carregado.
