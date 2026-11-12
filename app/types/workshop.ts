export type PermissionMap = Record<string, boolean>

export type WorkshopEntity = Record<string, unknown>

export type WorkshopOrganization = {
  id?: string
  name?: string | null
  trade_name?: string | null
  logo_url?: string | null
  person_type?: 'pf' | 'pj' | null
  tax_id?: string | null
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  zip_code?: string | null
  street?: string | null
  address_number?: string | null
  neighborhood?: string | null
  city?: string | null
  state?: string | null
} & WorkshopEntity

export type WorkshopCurrentUser = {
  id?: string
  display_name?: string | null
  full_name?: string | null
  email?: string | null
  organization_id?: string | null
} & WorkshopEntity

export type WorkshopAction = {
  id: string
  code: string
  name?: string | null
  description?: string | null
  resource?: string | null
  action_type?: string | null
} & WorkshopEntity

export type WorkshopRoleAction = {
  id: string
  role_id: string
  action_id: string
} & WorkshopEntity

export type WorkshopBootstrapResponse = {
  currentUser: WorkshopCurrentUser | null
  userRole: WorkshopEntity | null
  organization: WorkshopOrganization | null
  employee: WorkshopEntity | null
  roles: WorkshopEntity[]
  actions: WorkshopAction[]
  roleActions: WorkshopRoleAction[]
  permissions: PermissionMap
  organizationId: string | null
  isOwner: boolean
  isAdmin: boolean
  onboardingCompleted: boolean
  terminated: boolean
  termination_date: string | null
  termination_reason: string | null
  user: WorkshopEntity | null
  role: WorkshopEntity | null
  planKey: string | null
  maxEmployees: number | null
}
