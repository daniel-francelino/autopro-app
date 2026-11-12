import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import type { ClientNameRecord, ServiceOrderRecord } from '../../types/reports'

declare function defineEventHandler<T>(
  handler: (event: Parameters<typeof requireAuthUser>[0]) => T | Promise<T>
): (event: Parameters<typeof requireAuthUser>[0]) => Promise<T>

// Rows for the 4 selects below; each lists exactly the columns requested in `columns`.
type DashboardOrderRow = Pick<ServiceOrderRecord, 'id' | 'number' | 'status' | 'entry_date' | 'total_amount' | 'client_id'>
  & { reported_defect?: string | null, vehicle_id?: string | null }
type DashboardClientRow = ClientNameRecord
interface DashboardVehicleRow { id: string, brand?: string | null, model?: string | null, license_plate?: string | null }
interface DashboardAppointmentRow {
  id: string
  time?: string | null
  status?: string | null
  service_type?: string | null
  appointment_date?: string | null
  client_id?: string | null
  vehicle_id?: string | null
}

export interface RecentOrder {
  id: string
  number: string | number
  status: string
  entry_date: string
  reported_defect: string | null
  total_amount: number
  clientName: string
  vehicleLabel: string
}

export interface TodayAppointment {
  id: string
  time: string
  status: string
  service_type: string
  clientName: string
  vehicleLabel: string
}

const DASHBOARD_TIME_ZONE = 'America/Sao_Paulo'

function formatDateKeyInTimeZone(date: Date, timeZone = DASHBOARD_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  const parts = formatter.formatToParts(date)
  const year = parts.find(part => part.type === 'year')?.value ?? '0000'
  const month = parts.find(part => part.type === 'month')?.value ?? '01'
  const day = parts.find(part => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const now = new Date()
  const todayStr = formatDateKeyInTimeZone(now)
  const [currentYear, currentMonth] = todayStr.split('-')
  const defaultFrom = `${currentYear}-${currentMonth}-01`
  const nextMonthUtc = new Date(Date.UTC(Number(currentYear), Number(currentMonth), 1))
  const lastDay = formatDateKeyInTimeZone(new Date(nextMonthUtc.getTime() - 24 * 60 * 60 * 1000)).slice(-2)
  const defaultTo = `${currentYear}-${currentMonth}-${lastDay}`

  const [
    orders,
    clients,
    vehicles,
    appointments
  ] = await Promise.all([
    fetchAllOrganizationRows<DashboardOrderRow>(supabase, {
      table: 'service_orders',
      organizationId,
      columns: 'id, number, status, entry_date, reported_defect, total_amount, client_id, vehicle_id, created_at',
      nullColumns: ['deleted_at'],
      order: { column: 'created_at' }
    }),
    fetchAllOrganizationRows<DashboardClientRow>(supabase, {
      table: 'clients',
      organizationId,
      columns: 'id, name',
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<DashboardVehicleRow>(supabase, {
      table: 'vehicles',
      organizationId,
      columns: 'id, brand, model, license_plate',
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<DashboardAppointmentRow>(supabase, {
      table: 'appointments',
      organizationId,
      columns: 'id, time, status, service_type, appointment_date, client_id, vehicle_id',
      nullColumns: ['deleted_at'],
      order: { column: 'time', ascending: true }
    })
  ])

  const clientNameById = new Map(clients.map(client => [String(client.id), String(client.name || '')]))
  const vehicleById = new Map(vehicles.map(vehicle => [String(vehicle.id), vehicle]))

  const openOrdersCount = orders.filter(order => ['open', 'in_progress'].includes(String(order.status))).length

  const grossRevenue = orders
    .filter(order => ['completed', 'invoiced', 'delivered'].includes(String(order.status))
      && String(order.entry_date || '') >= defaultFrom
      && String(order.entry_date || '') <= defaultTo)
    .reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0)

  const totalClients = clients.length

  const todaySchedule = appointments
    .filter(appointment => String(appointment.appointment_date || '') === todayStr)
    .map((appointment) => {
      const vehicle = vehicleById.get(String(appointment.vehicle_id || ''))
      const brand = String(vehicle?.brand || '')
      const model = String(vehicle?.model || '')
      return {
        id: String(appointment.id),
        time: String(appointment.time || ''),
        status: String(appointment.status || ''),
        service_type: String(appointment.service_type || ''),
        clientName: clientNameById.get(String(appointment.client_id || '')) || '—',
        vehicleLabel: [brand, model].filter(Boolean).join(' ') || '—'
      }
    })

  const todayAppointmentsCount = todaySchedule.length

  const recentOrders: RecentOrder[] = orders.slice(0, 5).map((order) => {
    const vehicle = vehicleById.get(String(order.vehicle_id || ''))
    const brand = String(vehicle?.brand || '')
    const model = String(vehicle?.model || '')
    const plate = String(vehicle?.license_plate || '')
    const vehicleLabel = [brand, model].filter(Boolean).join(' ') + (plate ? ` — ${plate}` : '')

    return {
      id: String(order.id),
      number: String(order.number ?? ''),
      status: String(order.status || ''),
      entry_date: String(order.entry_date || ''),
      reported_defect: order.reported_defect ? String(order.reported_defect) : null,
      total_amount: Number(order.total_amount) || 0,
      clientName: clientNameById.get(String(order.client_id || '')) || '—',
      vehicleLabel: vehicleLabel || '—'
    }
  })

  return {
    openOrdersCount,
    grossRevenue,
    totalClients,
    todayAppointmentsCount,
    lowStockCount: 0, // stock tracking not yet implemented
    recentOrders,
    todaySchedule
  }
})
