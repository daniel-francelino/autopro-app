export enum ActionCode {
  CUSTOMERS_CREATE = 'customers.create',
  CUSTOMERS_READ = 'customers.read',
  CUSTOMERS_UPDATE = 'customers.update',
  CUSTOMERS_DELETE = 'customers.delete',

  VEHICLES_CREATE = 'vehicles.create',
  VEHICLES_READ = 'vehicles.read',
  VEHICLES_UPDATE = 'vehicles.update',
  VEHICLES_DELETE = 'vehicles.delete',

  ORDERS_CREATE = 'orders.create',
  ORDERS_READ = 'orders.read',
  ORDERS_UPDATE = 'orders.update',
  ORDERS_DELETE = 'orders.delete',
  ORDERS_FINISH = 'orders.finish',
  ORDERS_CANCEL = 'orders.cancel',
  ORDERS_CORRECT = 'orders.correct',

  PRODUCTS_CREATE = 'products.create',
  PRODUCTS_READ = 'products.read',
  PRODUCTS_UPDATE = 'products.update',
  PRODUCTS_DELETE = 'products.delete',

  PRODUCT_CATEGORIES_CREATE = 'product_categories.create',
  PRODUCT_CATEGORIES_READ = 'product_categories.read',
  PRODUCT_CATEGORIES_UPDATE = 'product_categories.update',
  PRODUCT_CATEGORIES_DELETE = 'product_categories.delete',

  INVENTORY_CREATE = 'inventory.create',
  INVENTORY_READ = 'inventory.read',
  INVENTORY_UPDATE = 'inventory.update',
  INVENTORY_DELETE = 'inventory.delete',
  INVENTORY_ADJUST = 'inventory.adjust',

  SUPPLIERS_CREATE = 'suppliers.create',
  SUPPLIERS_READ = 'suppliers.read',
  SUPPLIERS_UPDATE = 'suppliers.update',
  SUPPLIERS_DELETE = 'suppliers.delete',

  PURCHASES_CREATE = 'purchases.create',
  PURCHASES_READ = 'purchases.read',
  PURCHASES_UPDATE = 'purchases.update',
  PURCHASES_DELETE = 'purchases.delete',
  PURCHASES_AUTHORIZE = 'purchases.authorize',

  RETURNS_CREATE = 'returns.create',
  RETURNS_READ = 'returns.read',
  RETURNS_UPDATE = 'returns.update',
  RETURNS_DELETE = 'returns.delete',

  FINANCIAL_CREATE = 'financial.create',
  FINANCIAL_READ = 'financial.read',
  FINANCIAL_UPDATE = 'financial.update',
  FINANCIAL_DELETE = 'financial.delete',

  BANK_ACCOUNTS_CREATE = 'bank_accounts.create',
  BANK_ACCOUNTS_READ = 'bank_accounts.read',
  BANK_ACCOUNTS_UPDATE = 'bank_accounts.update',
  BANK_ACCOUNTS_DELETE = 'bank_accounts.delete',

  APPOINTMENTS_CREATE = 'appointments.create',
  APPOINTMENTS_READ = 'appointments.read',
  APPOINTMENTS_UPDATE = 'appointments.update',
  APPOINTMENTS_DELETE = 'appointments.delete',

  EMPLOYEES_CREATE = 'employees.create',
  EMPLOYEES_READ = 'employees.read',
  EMPLOYEES_UPDATE = 'employees.update',
  EMPLOYEES_DELETE = 'employees.delete',

  BONUSES_CREATE = 'bonuses.create',
  BONUSES_READ = 'bonuses.read',
  BONUSES_UPDATE = 'bonuses.update',
  BONUSES_DELETE = 'bonuses.delete',

  COMMISSIONS_CREATE = 'commissions.create',
  COMMISSIONS_READ = 'commissions.read',
  COMMISSIONS_UPDATE = 'commissions.update',
  COMMISSIONS_DELETE = 'commissions.delete',

  REPORTS_VIEW = 'reports.view',
  REPORTS_CUSTOMERS = 'reports.customers',
  REPORTS_FINANCIAL = 'reports.financial',
  REPORTS_COMMISSIONS = 'reports.commissions',
  REPORTS_SALES = 'reports.sales',
  REPORTS_PURCHASES = 'reports.purchases',
  REPORTS_COSTS = 'reports.costs',
  REPORTS_DEBTORS = 'reports.debtors',
  REPORTS_SUPPLIERS = 'reports.suppliers',
  REPORTS_PROFIT = 'reports.profit',
  REPORTS_EMPLOYEES = 'reports.employees',

  SETTINGS_VIEW = 'settings.view',
  SETTINGS_UPDATE = 'settings.update',

  ORGANIZATION_VIEW = 'organization.view',
  ORGANIZATION_UPDATE = 'organization.update',

  MEMBERS_VIEW = 'members.view',
  MEMBERS_INVITE = 'members.invite',
  MEMBERS_UPDATE = 'members.update',
  MEMBERS_REMOVE = 'members.remove',

  ROLES_VIEW = 'roles.view',
  ROLES_CREATE = 'roles.create',
  ROLES_UPDATE = 'roles.update',
  ROLES_DELETE = 'roles.delete',
  ROLES_MANAGE_PERMISSIONS = 'roles.manage_permissions',
  ROLES_MANAGE_MEMBERS = 'roles.manage_members',

  SUBSCRIPTION_VIEW = 'subscription.view',

  TAXES_VIEW = 'taxes.view',
  TAXES_UPDATE = 'taxes.update',

  PAYMENT_MACHINES_VIEW = 'payment_machines.view',
  PAYMENT_MACHINES_UPDATE = 'payment_machines.update',

  AUTHORIZATIONS_CREATE = 'authorizations.create',
  AUTHORIZATIONS_READ = 'authorizations.read',
  AUTHORIZATIONS_UPDATE = 'authorizations.update',
  AUTHORIZATIONS_DELETE = 'authorizations.delete',
  AUTHORIZATIONS_APPROVE = 'authorizations.approve',

  CONSULTATION_USE = 'consultation.use',
  CONSULTATION_VIEW = 'consultation.view',

  SERVICE_INVOICE_READ = 'service_invoice.read',
  SERVICE_INVOICE_CREATE = 'service_invoice.create',
  SERVICE_INVOICE_UPDATE = 'service_invoice.update',
  SERVICE_INVOICE_DELETE = 'service_invoice.delete'
}

export function isValidActionCode(code: string): code is ActionCode {
  return Object.values(ActionCode).includes(code as ActionCode)
}
