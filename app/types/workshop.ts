export type PermissionMap = Record<string, boolean>

export type WorkshopEntity = Record<string, unknown>

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
  currentUser: WorkshopEntity | null
  userRole: WorkshopEntity | null
  organization: WorkshopEntity | null
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
