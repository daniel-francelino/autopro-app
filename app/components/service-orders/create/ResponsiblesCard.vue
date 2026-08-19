<script setup lang="ts">
import { formatCurrency } from '~/utils/service-orders'
import type { CommissionBreakdownLine } from '../CommissionBreakdownPopover.vue'

interface SelectOption { label: string, value: string }

export type EmployeeCommissionDisplay = {
  commissionLabel: string
  note: { label: string, color: 'neutral' | 'warning' | 'primary', icon: string } | null
  hasInfo: boolean
  itemBreakdown: CommissionBreakdownLine[]
}

const props = defineProps<{
  modelValue: string[]
  employeeOptions: SelectOption[]
  employeeCommissions: Record<string, EmployeeCommissionDisplay>
  totalCommissionAmount: number
}>()

const emit = defineEmits<{
  'update:modelValue': [v: string[]]
  'add': []
  'remove': [index: number]
  'update': [index: number, employeeId: string]
}>()

function getOptionsForIndex(index: number) {
  const selectedIds = new Set(
    props.modelValue.filter((id, i) => i !== index && !!id)
  )
  return props.employeeOptions.filter(opt => !selectedIds.has(opt.value))
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-user-round-cog" class="size-4 text-primary" />
          <h3 class="font-semibold text-highlighted">
            Responsáveis e comissão
          </h3>
        </div>
        <UButton
          label="Adicionar"
          icon="i-lucide-user-plus"
          color="neutral"
          variant="outline"
          size="sm"
          @click="emit('add')"
        />
      </div>
    </template>

    <div class="space-y-4">
      <div
        v-if="!modelValue.length"
        class="rounded-xl border border-dashed border-default bg-elevated/40 px-4 py-8 text-center"
      >
        <UIcon name="i-lucide-users-round" class="mx-auto size-8 text-dimmed" />
        <p class="mt-3 text-sm font-medium text-highlighted">
          Nenhum responsável adicionado
        </p>
        <p class="mt-1 text-sm text-muted">
          Adicione responsáveis para já visualizar a previsão de comissão da OS.
        </p>
      </div>

      <div
        v-for="(employeeId, index) in modelValue"
        :key="`${index}-${employeeId}`"
        class="rounded-xl border border-default bg-default p-4 shadow-xs"
      >
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div class="min-w-0 flex-1">
            <UFormField>
              <UiAsyncPaginatedSelect
                :model-value="employeeId"
                :items="getOptionsForIndex(index)"
                :get-id="(o: SelectOption) => o.value"
                :get-label="(o: SelectOption) => o.label"
                placeholder="Selecione o funcionário"
                search-placeholder="Buscar funcionário..."
                empty-message="Nenhum funcionário disponível"
                icon="i-lucide-user-round"
                item-icon="i-lucide-user-round"
                class="w-full"
                @update:model-value="emit('update', index, $event)"
              />
            </UFormField>

            <div
              v-if="employeeCommissions[employeeId]?.hasInfo"
              class="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-elevated/60 px-3 py-2 text-sm lg:flex-nowrap"
            >
              <ServiceOrdersCommissionBreakdownPopover
                :total="employeeCommissions[employeeId]!.itemBreakdown.reduce((s, l) => s + l.amount, 0)"
                :lines="employeeCommissions[employeeId]!.itemBreakdown"
                title="Comissão por item"
                empty-message="Nenhum item comissionado"
                :disabled="!employeeCommissions[employeeId]!.itemBreakdown.length"
              >
                <UBadge
                  color="primary"
                  variant="soft"
                  leading-icon="i-lucide-wallet-cards"
                  :label="`Comissão: ${employeeCommissions[employeeId]!.commissionLabel}`"
                  class="cursor-default"
                />
              </ServiceOrdersCommissionBreakdownPopover>
              <UBadge
                v-if="employeeCommissions[employeeId]!.note"
                :color="employeeCommissions[employeeId]!.note!.color"
                variant="subtle"
                :leading-icon="employeeCommissions[employeeId]!.note!.icon"
                :label="employeeCommissions[employeeId]!.note!.label"
              />
            </div>
          </div>

          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            square
            @click="emit('remove', index)"
          />
        </div>
      </div>

      <div
        v-if="modelValue.length"
        class="rounded-xl border border-success/20 bg-success/10 p-4"
      >
        <p class="text-xs uppercase tracking-wide text-success/80">
          Total de comissão estimada
        </p>
        <p class="mt-1 text-lg font-semibold text-success">
          {{ formatCurrency(totalCommissionAmount) }}
        </p>
      </div>
    </div>
  </UCard>
</template>
