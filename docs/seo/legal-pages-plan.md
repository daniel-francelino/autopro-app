# Plano das páginas `/sobre`, `/termos` e `/privacidade` — AutoPro

> Status: **análise + plano** · Criado em 2026-11-08 · Base: leitura do código (Nuxt 4, Supabase, Stripe, OneSignal, Focus NFe / Nuvem Fiscal)
>
> **Aviso:** isto não é aconselhamento jurídico. Os rascunhos e as conclusões sobre a LGPD precisam de revisão por
> advogado antes de publicar. O que está aqui é o que o **código prova** e o que **só a empresa pode responder**.
>
> Complementa a [auditoria de SEO](seo-audit-2026-11-08.md) (Passo 7) e a [auditoria de GEO](geo-audit-brasil.md) (§6, §2.2).

## 1. Por que essas três páginas valem o esforço

| Página | Ganho de SEO / GEO | Ganho fora do SEO |
|---|---|---|
| `/sobre` | É a **âncora da entidade**: razão social, CNPJ, cidade e contato diferenciam o AutoPro de outras empresas com o mesmo nome (GEO §2.2) e alimentam `Organization`/`AboutPage`. Sinal de confiança (E-E-A-T) para o Google e para IAs | Compradores B2B procuram "quem está por trás" antes de pagar |
| `/termos` | Resolve a pergunta "posso cancelar? reembolsa? o que acontece com meus dados?", que as IAs respondem com o que estiver escrito. Dá fonte única às promessas do FAQ ("sem fidelidade", "cancele quando quiser") | Exigido na prática por Stripe e pelas lojas de aplicativos; base para chargeback |
| `/privacidade` | Sinal de confiança e requisito para publicar o app nas lojas (URL de política) | LGPD exige informar finalidades, compartilhamento e canal do titular; hoje o site coleta dados e **não explica** |

Sem as três, o rodapé não tem o que linkar (SEO Passo 7) e `Organization` fica sem dados verificáveis.

## 2. O que o produto faz com dados (verificado no código)

| Tema | O que o código mostra | Onde |
|---|---|---|
| Conta | Cadastro com **nome, e-mail e senha** (mín. 8). Autenticação Supabase; cookies `sb-access-token`, `sb-refresh-token`, `sb-user` (+ `sb-recovery-*` na recuperação de senha) | `signup.vue`, `server/utils/auth-cookies.ts` |
| Dados que a **oficina** cadastra | Clientes (nome, CPF/CNPJ, telefone, e-mail, endereço), veículos (placa), **funcionários** (CPF, endereço, salário, comissão, chave Pix, desligamento), OS, financeiro, estoque | `supabase/migrations/*create_clients*`, `*create_employees*` |
| Cobrança | Stripe (assinatura mensal, **só cartão**); portal do cliente; o cartão **não** passa pelo AutoPro | `server/api/billing/*`, `stripe/*` |
| Cancelamento | `cancel_at_period_end: true` — a assinatura segue **até o fim do período já pago**. Não há reembolso proporcional implementado | `server/api/billing/cancel.post.ts` |
| Exclusão de conta | `DELETE` apaga o **usuário de autenticação** (`auth.admin.deleteUser`). O código não mostra o que acontece com os dados da oficina (organização, clientes, OS, notas) | `server/api/auth/account.delete.ts` |
| Nota fiscal | Dados fiscais da empresa (CNPJ, inscrição municipal, regime, município IBGE) enviados à **Focus NFe** (e há código da **Nuvem Fiscal**) | `server/utils/focus-nfe.ts`, `nuvem-fiscal.ts`, README |
| Notificações push | **OneSignal** (identificador do dispositivo) | `useOneSignal.ts`, `plugins/onesignal.client.ts`, `public/push/` |
| Analytics | **Nenhum.** O PostHog foi removido do código (plugin, composable, eventos, variáveis e dependência). Não há rastreamento de terceiros no site | `git log` desta mudança |
| Consentimento | **Não existe** banner nem opt-out | busca por `consent` no app: vazio |
| Armazenamento no navegador | `localStorage` (tema, UTM), cookies de sessão acima | `useUserPreferences`, auth |

### 2.1 Papéis na LGPD (hipótese de trabalho — validar com advogado)

- **Oficina** = *controladora* dos dados dos clientes e funcionários **dela** (o AutoPro só os guarda e processa por ordem dela).
- **AutoPro (empresa)** = *operadora* desses dados e *controladora* dos dados da **conta do usuário** (nome, e-mail, uso do sistema, cobrança).
- Consequência para o texto: `/privacidade` fala dos dados da **conta e do site**; `/termos` define que a oficina é responsável por ter base legal
  para cadastrar dados de terceiros (clientes, funcionários) e que o AutoPro os trata conforme instruções dela.

### 2.2 Subprocessadores identificados

Supabase (banco e autenticação), Stripe (cobrança), Focus NFe e/ou Nuvem Fiscal (NFS-e), OneSignal (push) e a
hospedagem (**Vercel? não confirmado**). A política precisa listar o que de fato estiver em uso na data de publicação.

## 3. Problemas que a publicação vai expor (decidir **antes** de escrever)

1. ~~PostHog identificava pessoas~~ — **resolvido:** o PostHog foi removido. `/privacidade` pode declarar que não há analytics de terceiros. Se a telemetria própria do
   [plano de métricas](../metrics/usage-metrics-plan.md) for implementada depois (sem cookie nem ID persistente), a política deve ser atualizada junto.
2. **Exclusão de conta × dados da oficina.** Definir (com contador/advogado) o que é apagado, o que é anonimizado e o que precisa ser **retido por obrigação
   fiscal/legal** (notas emitidas, registros financeiros). Hoje o endpoint só remove o login.
3. **Cancelamento e reembolso.** O FAQ diz "sem fidelidade ou multa". O código cancela ao fim do período, sem reembolso. `/termos` precisa dizer isso com
   as mesmas palavras do FAQ — ou o produto muda.
4. **Inadimplência.** Confirmar o que acontece com o acesso quando o cartão falha (bloqueio imediato? carência?) e escrever no `/termos`.
5. **E-mail de conta fiscal.** `beenkoficial@gmail.com` é o padrão do dono da conta nos provedores fiscais (`focus-nfe.ts`, `nuvem-fiscal.ts`). Para uma
   empresa, um e-mail corporativo com domínio é melhor — e é o que `/sobre` e `Organization` vão exibir.
6. **Marca.** Títulos de telas internas dizem "beenk", o PDF diz "AutoPro Beenk", o site diz "AutoPro". `/sobre` deve explicar a relação (ex.: "AutoPro é um produto da Beenk").

## 4. O que só a empresa pode fornecer

Sem isto não dá para publicar — e **nada deve ser inventado**:

| # | Dado | Usado em |
|---:|---|---|
| 1 | **Razão social** e **nome fantasia** | `/sobre`, `/termos`, rodapé, `Organization.legalName` |
| 2 | **CNPJ** (e inscrições, se quiser exibir) | `/sobre`, `/termos`, `Organization.taxID` |
| 3 | **Endereço** (cidade/UF no mínimo) | `/sobre`, `/termos`, `Organization.address` |
| 4 | **E-mail oficial** (confirmar `suporte@beenk.com.br`) e WhatsApp, se houver | `/sobre`, `/privacidade`, `contactPoint` |
| 5 | **Encarregado de dados (DPO)**: nome/canal. A LGPD manda divulgar a identidade e o contato do encarregado, de preferência no site; **pode haver dispensa para agentes de pequeno porte** (regulamentação da ANPD) — o advogado confirma | `/privacidade` |
| 6 | **Foro** e lei aplicável | `/termos` |
| 7 | **Política de cancelamento, reembolso, reajuste e inadimplência** (§3.3–3.4) | `/termos`, FAQ |
| 8 | **Retenção e exclusão de dados** (§3.2) | `/privacidade`, `/termos` |
| 9 | **Região dos servidores** (Supabase) e hospedagem; se há **transferência internacional** | `/privacidade` |
| 10 | **Lista final de subprocessadores** em uso | `/privacidade` |
| 11 | **Quem fundou/lidera** e a **história** em 2–3 frases reais; foto/links só se quiserem | `/sobre` |
| 12 | **Perfis oficiais** (LinkedIn, Instagram, YouTube) | `/sobre`, `Organization.sameAs` |
| 13 | **Disponibilidade/suporte**: horário e prazo de resposta que a empresa consegue cumprir | `/termos`, `/sobre` |
| 14 | **Idade/uso permitido**, limites de uso razoável, regras de conteúdo | `/termos` |
| 15 | **Quem revisa os textos** (advogado) e a **data de vigência** | rodapé de cada página |

## 5. Estrutura recomendada de cada página

### `/sobre`
1. Quem somos (2–3 frases: AutoPro é um sistema online para oficinas mecânicas, da **[razão social]**, de **[cidade/UF]**).
2. O que fazemos e para quem (link para `/sistema-para-oficina-mecanica`).
3. Como o produto é feito: o que é verificável (módulos reais, planos, suporte por plano).
4. Dados da empresa: razão social, CNPJ, endereço, e-mail, WhatsApp.
5. Pessoas (somente com autorização), perfis oficiais.
6. Links: Termos, Privacidade, Planos, Contato.

### `/termos` (Termos de Uso e Assinatura)
Definições (AutoPro, Oficina/Cliente, Usuário) · cadastro e conta · **planos, preço, cobrança mensal no cartão, reajuste** · **cancelamento (fim do período), reembolso, inadimplência** ·
responsabilidades da oficina (dados de terceiros, emissão fiscal correta, configuração de NFS-e e **limites: sem NF-e**) · disponibilidade e suporte · propriedade intelectual · **limitação de responsabilidade** · rescisão e
**o que acontece com os dados** · alterações dos termos · lei e foro · contato.

### `/privacidade` (Política de Privacidade)
Quem é o controlador e o contato/encarregado · **quais dados** (conta, cobrança, uso, push, dados da oficina como operadora) · **para quê e base legal** · com quem compartilhamos (subprocessadores, §2.2) ·
**cookies e armazenamento** (§2) · retenção e exclusão · **direitos do titular** (art. 18) e como exercer · segurança · transferência internacional · crianças · alterações · data de vigência.

## 6. Implementação técnica (quando os dados chegarem)

1. **Reaproveitar o gabarito** de `[slug].vue` / coleção `paginas`: `content/paginas/sobre.md`, `termos.md`, `privacidade.md`. Acrescentar ao schema um campo `kind: legal | guia`
   para esconder o CTA de venda e o bloco "Leia também" nas páginas legais, e um campo `effectiveDate` (vigência) exibido no topo.
2. **JSON-LD:** `/sobre` com `AboutPage` + `Organization` completa (`legalName`, `taxID`, `address`, `contactPoint`, `sameAs` reais); termos e privacidade como `WebPage`. Atualizar o
   `Organization` da home com os mesmos campos (uma fonte só: `useSiteUrl`/`app/utils/company.ts`).
3. **Rodapé** (`AppFooter.vue` e rodapé da landing): Sobre · Termos · Privacidade · Contato, ao lado dos links atuais. Rodapé do `/login` e do `/signup` também.
4. **Aceite no cadastro:** checkbox "Li e aceito os Termos e a Política" em `signup.vue`, gravando **versão e data do aceite** (tabela de consentimentos). Sem isso o termo não tem força prática.
5. **Sitemap, `prerender`, `llms.txt`** e `check-public-claims.mjs`: incluir as três; o script também deve falhar se `/termos` contradisser o FAQ (cancelamento, cartão).
6. **Versionamento:** manter `docs/legal/` com as versões antigas (data de vigência) e um *changelog* curto.
7. **App nas lojas:** a URL de `/privacidade` é exigida no cadastro do app (e o `appId` já foi definido).

## 7. Ordem de trabalho

| Fase | Entrega | Quem | Esforço |
|---|---|---|---|
| 0 | Responder a tabela do §4 e decidir os itens do §3 (exclusão, reembolso, inadimplência) | Empresa | 1–3 dias |
| 1 | Minuta de `/termos` e `/privacidade` a partir do §5 com os dados reais | Dev + advogado | 2–5 dias (advogado) |
| 2 | `/sobre` com dados reais e `Organization` completo | Dev | 0,5 dia |
| 3 | Gabarito `kind: legal`, rodapé, JSON-LD, sitemap, `llms.txt` | Dev | 1 dia |
| 4 | Checkbox de aceite com registro de versão | Dev | 1 dia |
| 5 | (Opcional) telemetria própria do plano de métricas, atualizando a política | Dev | conforme o plano |

## 8. Checklist de aceitação

- [ ] Nenhum campo `[PREENCHER]` em produção; CNPJ, razão social e endereço conferidos com o cartão CNPJ.
- [ ] Texto de `/termos` sobre cancelamento, cartão e "sem fidelidade" **idêntico em significado** ao FAQ e a `/pricing`.
- [ ] `/privacidade` lista exatamente os subprocessadores em uso e cita cookies/armazenamento reais.
- [ ] Canal do titular e (se aplicável) encarregado publicados; e-mail responde.
- [ ] Revisão por advogado registrada (nome e data) fora do site.
- [ ] Links no rodapé de todas as páginas públicas; `Organization` da home e de `/sobre` iguais.
- [ ] Páginas pré-renderizadas, no sitemap e no `llms.txt`; `JSON-LD` válido.
- [ ] Aceite no cadastro grava versão e data.
