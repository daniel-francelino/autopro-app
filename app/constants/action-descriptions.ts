import { ActionCode } from './action-codes'

/**
 * Descricao de uma linha (pt-BR) de cada permissao, exibida na tela de papeis no lugar do codigo tecnico.
 * Apenas texto de apresentacao: nao altera API, banco nem regra de acesso.
 * Codigos marcados com "REVISAR" tem descricao neutra baseada no nome e aguardam revisao do stakeholder
 * (lista em docs/engineering/roles-endpoint-remediation-phase1-5-report.md).
 */
export const ACTION_DESCRIPTIONS: Record<ActionCode, string> = {
  [ActionCode.CUSTOMERS_CREATE]: 'Cadastrar novos clientes da oficina.',
  [ActionCode.CUSTOMERS_READ]: 'Ver a lista e os dados dos clientes.',
  [ActionCode.CUSTOMERS_UPDATE]: 'Alterar os dados de clientes já cadastrados.',
  [ActionCode.CUSTOMERS_DELETE]: 'Excluir clientes do cadastro.',

  [ActionCode.VEHICLES_CREATE]: 'Cadastrar novos veículos dos clientes.',
  [ActionCode.VEHICLES_READ]: 'Ver a lista e os dados dos veículos.',
  [ActionCode.VEHICLES_UPDATE]: 'Alterar os dados de veículos já cadastrados.',
  [ActionCode.VEHICLES_DELETE]: 'Excluir veículos do cadastro.',

  [ActionCode.ORDERS_CREATE]: 'Abrir novas ordens de serviço.',
  [ActionCode.ORDERS_READ]: 'Ver as ordens de serviço e seus detalhes.',
  [ActionCode.ORDERS_UPDATE]: 'Alterar ordens de serviço em andamento.',
  [ActionCode.ORDERS_DELETE]: 'Excluir ordens de serviço.',
  [ActionCode.ORDERS_CANCEL]: 'Cancelar ordens de serviço.',
  // REVISAR: "corrigir" nao tem regra explicita no codigo consultado.
  [ActionCode.ORDERS_CORRECT]: 'Corrigir uma ordem de serviço já registrada.',
  [ActionCode.ORDERS_PAY]: 'Registrar pagamentos e entradas nas ordens de serviço.',
  [ActionCode.ORDERS_HISTORY]: 'Ver o histórico (linha do tempo) da ordem de serviço.',

  [ActionCode.PRODUCTS_CREATE]: 'Cadastrar novos produtos.',
  [ActionCode.PRODUCTS_READ]: 'Ver a lista e os dados dos produtos.',
  [ActionCode.PRODUCTS_UPDATE]: 'Alterar os dados de produtos já cadastrados.',
  [ActionCode.PRODUCTS_DELETE]: 'Excluir produtos do cadastro.',

  [ActionCode.PRODUCT_CATEGORIES_CREATE]: 'Criar novas categorias de produtos.',
  [ActionCode.PRODUCT_CATEGORIES_READ]: 'Ver as categorias de produtos.',
  [ActionCode.PRODUCT_CATEGORIES_UPDATE]: 'Alterar categorias de produtos existentes.',
  [ActionCode.PRODUCT_CATEGORIES_DELETE]: 'Excluir categorias de produtos.',

  [ActionCode.INVENTORY_CREATE]: 'Cadastrar novos itens no estoque.',
  [ActionCode.INVENTORY_READ]: 'Ver os itens e as quantidades do estoque.',
  [ActionCode.INVENTORY_UPDATE]: 'Alterar itens do estoque.',
  [ActionCode.INVENTORY_DELETE]: 'Excluir itens do estoque.',

  [ActionCode.SUPPLIERS_CREATE]: 'Cadastrar novos fornecedores.',
  [ActionCode.SUPPLIERS_READ]: 'Ver a lista e os dados dos fornecedores.',
  [ActionCode.SUPPLIERS_UPDATE]: 'Alterar os dados de fornecedores já cadastrados.',
  [ActionCode.SUPPLIERS_DELETE]: 'Excluir fornecedores do cadastro.',

  [ActionCode.PURCHASES_CREATE]: 'Registrar novas compras de mercadorias.',
  [ActionCode.PURCHASES_READ]: 'Ver as compras registradas.',
  [ActionCode.PURCHASES_UPDATE]: 'Alterar compras já registradas.',
  [ActionCode.PURCHASES_DELETE]: 'Excluir compras registradas.',

  // Devolucoes: usadas nas rotas de devolucao de compra (purchase-returns).
  [ActionCode.RETURNS_CREATE]: 'Registrar devoluções de compras ao fornecedor.',
  [ActionCode.RETURNS_READ]: 'Ver as devoluções registradas.',
  [ActionCode.RETURNS_UPDATE]: 'Alterar devoluções já registradas.',
  [ActionCode.RETURNS_DELETE]: 'Excluir devoluções registradas.',

  [ActionCode.APPOINTMENTS_CREATE]: 'Criar novos agendamentos.',
  [ActionCode.APPOINTMENTS_READ]: 'Ver a agenda e os agendamentos.',
  [ActionCode.APPOINTMENTS_UPDATE]: 'Alterar agendamentos existentes.',
  [ActionCode.APPOINTMENTS_DELETE]: 'Excluir agendamentos.',

  [ActionCode.EMPLOYEES_CREATE]: 'Cadastrar novos funcionários.',
  [ActionCode.EMPLOYEES_READ]: 'Ver a lista e os dados dos funcionários.',
  [ActionCode.EMPLOYEES_UPDATE]: 'Alterar os dados de funcionários.',
  [ActionCode.EMPLOYEES_DELETE]: 'Excluir funcionários do cadastro.',
  // REVISAR: sem uso identificado no codigo; descricao baseada no nome.
  [ActionCode.EMPLOYEES_PAY]: 'Registrar pagamentos a funcionários.',

  [ActionCode.FINANCIAL_CREATE]: 'Criar lançamentos financeiros (receitas e despesas).',
  [ActionCode.FINANCIAL_READ]: 'Ver o financeiro e seus lançamentos.',
  [ActionCode.FINANCIAL_UPDATE]: 'Alterar lançamentos financeiros.',
  [ActionCode.FINANCIAL_DELETE]: 'Excluir lançamentos financeiros.',

  [ActionCode.BANK_ACCOUNTS_CREATE]: 'Cadastrar novas contas bancárias.',
  [ActionCode.BANK_ACCOUNTS_VIEW]: 'Ver as contas bancárias e seus saldos.',
  [ActionCode.BANK_ACCOUNTS_UPDATE]: 'Alterar contas bancárias existentes.',
  [ActionCode.BANK_ACCOUNTS_DELETE]: 'Excluir contas bancárias.',

  [ActionCode.REPORTS_VIEW]: 'Abrir a área de relatórios e a visão geral.',
  [ActionCode.REPORTS_FINANCIAL]: 'Ver os relatórios financeiros.',
  [ActionCode.REPORTS_SALES]: 'Ver os relatórios de vendas.',
  [ActionCode.REPORTS_PURCHASES]: 'Ver os relatórios de compras.',
  [ActionCode.REPORTS_PROFIT]: 'Ver os relatórios de lucro.',
  [ActionCode.REPORTS_COSTS]: 'Ver os relatórios de custos.',
  [ActionCode.REPORTS_CUSTOMERS]: 'Ver os relatórios de clientes.',
  [ActionCode.REPORTS_SUPPLIERS]: 'Ver os relatórios de fornecedores.',
  [ActionCode.REPORTS_DEBTORS]: 'Ver o relatório de devedores (valores em aberto).',
  [ActionCode.REPORTS_COMMISSIONS]: 'Ver os relatórios de comissões.',
  [ActionCode.REPORTS_EMPLOYEES]: 'Ver o relatório por funcionário (OS, comissões e itens vendidos).',

  [ActionCode.COMMISSIONS_CREATE]: 'Criar novas configurações de comissão.',
  [ActionCode.COMMISSIONS_READ]: 'Ver as configurações de comissão e seus funcionários.',
  [ActionCode.COMMISSIONS_UPDATE]: 'Alterar comissões, regras e funcionários atribuídos.',
  [ActionCode.COMMISSIONS_DELETE]: 'Excluir configurações de comissão.',

  [ActionCode.BONUSES_CREATE]: 'Criar novos bônus.',
  [ActionCode.BONUSES_READ]: 'Ver os bônus, o progresso e o histórico de valores.',
  [ActionCode.BONUSES_UPDATE]: 'Alterar bônus, valores e funcionários atribuídos.',
  [ActionCode.BONUSES_DELETE]: 'Excluir bônus.',

  [ActionCode.ROLES_CREATE]: 'Criar novos papéis de acesso.',
  [ActionCode.ROLES_READ]: 'Ver os papéis e as permissões de cada um.',
  [ActionCode.ROLES_UPDATE]: 'Alterar o nome e a descrição de papéis.',
  [ActionCode.ROLES_DELETE]: 'Excluir papéis sem usuários vinculados.',
  [ActionCode.ROLES_MANAGE_PERMISSIONS]: 'Liberar ou bloquear as permissões de um papel.',
  [ActionCode.ROLES_MANAGE_MEMBERS]: 'Trocar o papel dos usuários da oficina.',

  // REVISAR (membros): sem uso identificado para view/update/delete; descricao baseada no nome.
  [ActionCode.MEMBERS_VIEW]: 'Ver a lista de usuários da oficina.',
  [ActionCode.MEMBERS_INVITE]: 'Convidar pessoas e liberar acesso ao sistema.',
  [ActionCode.MEMBERS_UPDATE]: 'Alterar os dados de usuários da oficina.',
  [ActionCode.MEMBERS_DELETE]: 'Remover usuários da oficina.',

  // REVISAR (organizacao/configuracoes): descricoes baseadas no nome.
  [ActionCode.ORGANIZATION_VIEW]: 'Ver os dados cadastrais da oficina.',
  [ActionCode.ORGANIZATION_UPDATE]: 'Alterar os dados cadastrais da oficina.',
  [ActionCode.SETTINGS_VIEW]: 'Ver as configurações do sistema.',
  [ActionCode.SETTINGS_UPDATE]: 'Alterar as configurações do sistema.',

  [ActionCode.SUBSCRIPTION_VIEW]: 'Ver o plano e a assinatura da oficina.',
  [ActionCode.SUBSCRIPTION_MANAGE]: 'Contratar, trocar ou cancelar o plano da oficina.',

  // REVISAR: abrange a area fiscal; escopo exato nao detalhado no codigo.
  [ActionCode.FISCAL_MANAGE]: 'Gerenciar a configuração e os recursos fiscais.',

  [ActionCode.TAXES_VIEW]: 'Ver os impostos cadastrados.',
  [ActionCode.TAXES_UPDATE]: 'Alterar os impostos cadastrados.',

  [ActionCode.PAYMENT_MACHINES_VIEW]: 'Ver as maquininhas de cartão cadastradas.',
  [ActionCode.PAYMENT_MACHINES_UPDATE]: 'Cadastrar, alterar e excluir maquininhas de cartão.',

  // Autorizacoes: nas rotas correspondem a solicitacoes de compra (purchase-requests).
  [ActionCode.AUTHORIZATIONS_CREATE]: 'Criar solicitações de compra para aprovação.',
  [ActionCode.AUTHORIZATIONS_READ]: 'Ver as solicitações de compra e seu andamento.',
  [ActionCode.AUTHORIZATIONS_UPDATE]: 'Alterar solicitações de compra.',
  [ActionCode.AUTHORIZATIONS_DELETE]: 'Excluir solicitações de compra.',
  [ActionCode.AUTHORIZATIONS_APPROVE]: 'Aprovar ou rejeitar solicitações de compra.',

  // REVISAR (consultoria IA): sem uso identificado no codigo; descricoes baseadas no nome.
  [ActionCode.CONSULTATION_USE]: 'Usar a consultoria com inteligência artificial.',
  [ActionCode.CONSULTATION_VIEW]: 'Ver as consultorias já realizadas.',

  [ActionCode.SERVICE_INVOICE_READ]: 'Ver as notas fiscais de serviço emitidas.',
  [ActionCode.SERVICE_INVOICE_CREATE]: 'Emitir notas fiscais de serviço.',
  [ActionCode.SERVICE_INVOICE_UPDATE]: 'Corrigir notas fiscais de serviço.',
  [ActionCode.SERVICE_INVOICE_DELETE]: 'Cancelar notas fiscais de serviço.'
}

/** Descricao curta de um codigo, ou null quando nao ha no mapa. */
export function getActionDescription(code: string): string | null {
  return (ACTION_DESCRIPTIONS as Record<string, string>)[code] ?? null
}
