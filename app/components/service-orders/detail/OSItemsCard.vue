<script setup lang="ts">
import type { ServiceOrderDetailFull } from '~/types/service-orders'
import { formatCurrency } from '~/utils/service-orders'
import type { CommissionBreakdownLine } from '../CommissionBreakdownPopover.vue'

type OrderItem = ServiceOrderDetailFull['order']['items'][number]

const props = defineProps<{
  order: ServiceOrderDetailFull['order']
  employees: ServiceOrderDetailFull['employees']
}>()

const items = computed(() => props.order.items ?? [])

function getItemSource(item: OrderItem) {
  return item.product_id ? 'catalog' : 'manual'
}

function getItemTotal(item: OrderItem) {
  return (
    item.total_price ?? item.total_amount ?? item.unit_price * item.quantity
  )
}

function getItemCost(item: OrderItem) {
  return item.cost_price ?? item.cost_amount ?? 0
}

function getItemCommission(item: OrderItem) {
  return item.commission_total ?? item.total_commission ?? 0
}

function getItemCommissionLines(item: OrderItem): CommissionBreakdownLine[] {
  return (item.commissions ?? [])
    .map((c) => {
      const emp = props.employees.find(e => e.id === c.employee_id)
      const typeLabel
        = c.commission_type === 'percentage'
          ? `${c.commission_percentage}% • ${c.commission_base === 'profit' ? 'Lucro' : 'Faturamento'}`
          : `Valor fixo • ${c.commission_base === 'profit' ? 'Lucro' : 'Faturamento'}`
      return {
        label: emp?.name ?? 'Funcionário',
        sublabel: typeLabel,
        amount: Number(c.amount ?? 0)
      }
    })
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-package" class="size-4 text-primary" />
        <h3 class="font-semibold text-highlighted">
          Itens da OS
        </h3>
      </div>
    </template>

    <div
      v-if="!items.length"
      class="rounded-2xl border border-default bg-elevated/40 px-6 py-10 text-center"
    >
      <UIcon
        name="i-lucide-package-search"
        class="mx-auto size-10 text-dimmed"
      />
      <p class="mt-4 text-sm font-medium text-highlighted">
        Nenhum item registrado
      </p>
      <p class="mt-1 text-sm text-muted">
        Esta OS ainda não possui itens vinculados.
      </p>
    </div>

    <div v-else class="space-y-4">
      <div class="hidden overflow-x-auto lg:block">
        <table
          class="min-w-full divide-y divide-default overflow-hidden rounded-2xl border border-default bg-default text-sm"
        >
          <thead
            class="bg-elevated/70 text-left text-xs uppercase tracking-wide text-muted"
          >
            <tr>
              <th class="px-4 py-3 font-medium">
                Descrição
              </th>
              <th class="w-24 px-4 py-3 font-medium">
                Qtd
              </th>
              <th class="w-32 px-4 py-3 font-medium">
                Venda
              </th>
              <th class="w-32 px-4 py-3 font-medium">
                Custo
              </th>
              <th class="w-28 px-4 py-3 text-right font-medium">
                Comissão
              </th>
              <th class="w-32 px-4 py-3 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr
              v-for="(item, index) in items"
              :key="`${index}-${item.name ?? item.description ?? 'item'}`"
              class="align-top"
            >
              <td class="px-4 py-4">
                <div class="flex items-center gap-2">
                  <UBadge
                    v-if="item.category_name"
                    :label="item.category_name"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  />
                  <UTooltip
                    :text="
                      getItemSource(item) === 'catalog'
                        ? 'Item do catálogo'
                        : 'Item manual'
                    "
                  >
                    <div
                      class="flex size-6 shrink-0 items-center justify-center rounded-lg"
                      :class="
                        getItemSource(item) === 'catalog'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-elevated text-muted'
                      "
                    >
                      <UIcon
                        :name="
                          getItemSource(item) === 'catalog'
                            ? 'i-lucide-package-check'
                            : 'i-lucide-pencil-ruler'
                        "
                        class="size-3.5"
                      />
                    </div>
                  </UTooltip>

                  <div class="min-w-0 flex-1">
                    <div
                      class="rounded-xl border border-default bg-default px-3 py-2 text-default"
                    >
                      <span class="block truncate">
                        {{ item.description || item.name || "—" }}
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-4 text-center text-muted">
                {{ item.quantity }}
              </td>
              <td class="px-4 py-4 text-right text-muted">
                {{ formatCurrency(item.unit_price) }}
              </td>
              <td class="px-4 py-4 text-right text-muted">
                {{ formatCurrency(getItemCost(item)) }}
              </td>
              <td class="px-4 py-4 text-right font-semibold text-info">
                <ServiceOrdersCommissionBreakdownPopover
                  :total="getItemCommission(item)"
                  :lines="getItemCommissionLines(item)"
                  title="Comissão por funcionário"
                  empty-message="Nenhum funcionário responsável"
                  :disabled="!getItemCommissionLines(item).length"
                >
                  <span class="inline-flex cursor-default items-center gap-1">
                    {{ formatCurrency(getItemCommission(item)) }}
                    <UIcon
                      v-if="getItemCommissionLines(item).length"
                      name="i-lucide-info"
                      class="size-3 text-info/60"
                    />
                  </span>
                </ServiceOrdersCommissionBreakdownPopover>
              </td>
              <td class="px-4 py-4 text-right font-semibold text-highlighted">
                {{ formatCurrency(getItemTotal(item)) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="space-y-3 lg:hidden">
        <div
          v-for="(item, index) in items"
          :key="`${index}-${item.name ?? item.description ?? 'item-mobile'}`"
          class="rounded-2xl border border-default bg-default p-4 shadow-xs"
        >
          <div class="flex items-start gap-2">
            <UTooltip
              :text="
                getItemSource(item) === 'catalog'
                  ? 'Item do catálogo'
                  : 'Item manual'
              "
            >
              <div
                class="flex size-6 shrink-0 items-center justify-center rounded-lg"
                :class="
                  getItemSource(item) === 'catalog'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-elevated text-muted'
                "
              >
                <UIcon
                  :name="
                    getItemSource(item) === 'catalog'
                      ? 'i-lucide-package-check'
                      : 'i-lucide-pencil-ruler'
                  "
                  class="size-3.5"
                />
              </div>
            </UTooltip>

            <div class="min-w-0 flex-1">
              <UBadge
                v-if="item.category_name"
                :label="item.category_name"
                color="neutral"
                variant="subtle"
                size="xs"
                class="mb-1"
              />
              <div
                class="rounded-xl border border-default bg-default px-3 py-2 text-default"
              >
                <span class="block truncate">
                  {{ item.description || item.name || "—" }}
                </span>
              </div>
            </div>
          </div>

          <div class="mt-4 space-y-4">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <UFormField label="Quantidade">
                <div
                  class="rounded-xl border border-default bg-default px-3 py-2 text-sm text-default"
                >
                  {{ item.quantity }}
                </div>
              </UFormField>

              <UFormField label="Venda">
                <div
                  class="rounded-xl border border-default bg-default px-3 py-2 text-sm text-default"
                >
                  {{ formatCurrency(item.unit_price) }}
                </div>
              </UFormField>

              <UFormField label="Custo">
                <div
                  class="rounded-xl border border-default bg-default px-3 py-2 text-sm text-default"
                >
                  {{ formatCurrency(getItemCost(item)) }}
                </div>
              </UFormField>
            </div>

            <div class="rounded-xl bg-elevated/60 px-4 py-3 text-sm">
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">Total do item</span>
                <ServiceOrdersCommissionBreakdownPopover
                  :total="getItemCommission(item)"
                  :lines="getItemCommissionLines(item)"
                  title="Comissão por funcionário"
                  empty-message="Nenhum funcionário responsável"
                  :disabled="!getItemCommissionLines(item).length"
                >
                  <span
                    class="inline-flex cursor-default items-center gap-1 text-xs font-medium text-info"
                  >
                    Com.: {{ formatCurrency(getItemCommission(item)) }}
                    <UIcon
                      v-if="getItemCommissionLines(item).length"
                      name="i-lucide-info"
                      class="size-3 text-info/60"
                    />
                  </span>
                </ServiceOrdersCommissionBreakdownPopover>
              </div>
              <p class="mt-1 font-semibold text-highlighted">
                {{ formatCurrency(getItemTotal(item)) }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
