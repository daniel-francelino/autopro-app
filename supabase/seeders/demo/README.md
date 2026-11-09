# Seeder demo (dados de produção anonimizados)

Uma oficina completa e realista para testar: 1.265 OS, 6.288 lançamentos, 3.801 linhas de extrato, 211 clientes, 106 veículos,
13 funcionários, 19 planos de comissão, 364 produtos, 203 produtos mestre, 37 fornecedores, papéis e 86 permissões.
Os dados vêm de uma oficina real, mas já estão **anonimizados**: nomes, CPF/CNPJ, telefones, e-mails, endereços, placas, ids do Stripe
e UUIDs foram trocados por valores fictícios, mantendo os vínculos entre as tabelas. As despesas pessoais do dono têm a descrição
trocada por um título genérico equivalente. Valores, datas, status e volumes são os reais.

## Como usar (com a stack local no ar)

```bash
pnpm stack:up
pnpm seed:demo          # carrega e cria os logins (~40 s). Pode rodar de novo: apaga e recria a oficina demo
```

| Login | Senha | Papel |
|---|---|---|
| `admin@demo.autopro.test` | `Demo@12345` (ou `DEMO_PASSWORD`) | admin da oficina |
| `funcionario@demo.autopro.test` | idem | papel limitado real da oficina |

Para apontar o app para a stack, use as variáveis `E2E_SUPABASE_*` (valores em `supabase/e2e/stack.env`, ver `tests/README.md`).

## Arquivos

| Arquivo | O que é |
|---|---|
| `demo.sql.gz` | os dados (SQL com `INSERT`s). Apaga a oficina demo e recria; carrega com gatilhos desligados, porque o dado já é consistente |
| `demo.meta.json` | id da oficina demo e contagem de linhas por tabela |
| `../../../scripts/seed/load-demo.mjs` | carrega o SQL na stack local e cria os dois logins |

O `demo.sql.gz` é o resultado final: não há script de geração no projeto. Não edite à mão.

## Limites conhecidos

1. **Valores reais permanecem** (salário, comissão, saldo, faturamento). Estão desvinculados de pessoas reais, mas descrevem uma oficina real.
2. **Texto livre** (observações, diagnóstico) pode conter alguma palavra que lembre o dado original; nomes de pessoas foram removidos, mas não há garantia absoluta para termos raros.
3. **A produção tem inconsistências que o seeder preserva**: o saldo atual das contas não é igual a "saldo inicial + extrato"
   (ex.: diferença de R$ 436 mil numa conta). Não escreva testes que assumam essa invariante sobre o seeder; para isso use oficinas criadas pelo teste.
4. A stack local só tem 23 `actions` por padrão; o seeder acrescenta as da produção (sem sobrescrever as existentes).
5. Referências a tabelas que não vieram (NF-e/NFS-e, maquininhas, compras, agenda) estão nulas, e a oficina entra ativa e sem vínculo com Stripe.
