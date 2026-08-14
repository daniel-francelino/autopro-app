<script setup lang="ts">
interface MasterProductDisplay { name: string, description?: string | null }
interface MasterProductSelected { id: string, name: string, description: string | null, notes: string | null }
interface ClientRecord { id: string, name: string }
interface VehicleRecord { id: string, brand: string | null, model: string | null, license_plate: string | null, client_id?: string | null }

defineProps<{
  number: string
  status: string
  clientId: string
  vehicleId: string
  masterProductId: string
  entryDate: string | undefined
  expectedDate: string | undefined
  clientSelectedLabel: string | null
  vehicleSelectedLabel: string | null
  selectedMasterProduct: MasterProductDisplay | null
  isLoadingNextNumber: boolean
}>()

const emit = defineEmits<{
  'update:number': [v: string]
  'update:status': [v: string]
  'update:clientId': [v: string]
  'update:vehicleId': [v: string]
  'update:masterProductId': [v: string]
  'update:entryDate': [v: string | undefined]
  'update:expectedDate': [v: string | undefined]
  'selectClient': [client: ClientRecord]
  'clearClient': []
  'selectVehicle': [vehicle: VehicleRecord]
  'clearVehicle': []
  'selectMasterProduct': [product: MasterProductSelected]
  'clearMasterProduct': []
  'openMasterProductEditor': []
  'openMasterProductManager': []
}>()

function vehicleLabel(v: VehicleRecord) {
  return [v.brand, v.model, v.license_plate].filter(Boolean).join(' - ') || '—'
}

const statusOptions = [
  { label: 'Orçamento', value: 'estimate' },
  { label: 'Aberta', value: 'open' },
  { label: 'Em andamento', value: 'in_progress' },
  { label: 'Aguard. peça', value: 'waiting_for_part' },
  { label: 'Concluída', value: 'completed' },
  { label: 'Entregue', value: 'delivered' },
  { label: 'Cancelada', value: 'cancelled' }
]
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-clipboard-list" class="size-4 text-primary" />
        <h3 class="font-semibold text-highlighted">
          Informações básicas
        </h3>
      </div>
    </template>

    <div class="space-y-4">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <UFormField label="Número da OS">
          <UInput
            :model-value="number"
            :placeholder="isLoadingNextNumber ? 'Gerando número...' : 'Auto (ex: OS4001)'"
            class="w-full"
            @update:model-value="emit('update:number', String($event ?? ''))"
          />
          <p v-if="isLoadingNextNumber" class="mt-2 text-xs text-muted">
            Buscando o próximo número disponível...
          </p>
        </UFormField>

        <UFormField label="Status">
          <USelectMenu
            :model-value="status"
            :items="statusOptions"
            value-key="value"
            class="w-full"
            :search-input="false"
            @update:model-value="emit('update:status', String($event ?? ''))"
          />
        </UFormField>
      </div>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <UFormField label="Data de entrada">
          <UiDatePicker
            :model-value="entryDate"
            placeholder="Selecione a data"
            class="w-full"
            @update:model-value="emit('update:entryDate', $event as string | undefined)"
          />
        </UFormField>

        <UFormField label="Data prevista">
          <UiDatePicker
            :model-value="expectedDate"
            placeholder="Selecione a data"
            class="w-full"
            @update:model-value="emit('update:expectedDate', $event as string | undefined)"
          />
        </UFormField>

        <UFormField label="Cliente">
          <UiAsyncPaginatedSelect
            :model-value="clientId"
            fetch-url="/api/clients"
            :get-label="(c: ClientRecord) => c.name"
            :selected-label="clientSelectedLabel"
            placeholder="Sem cliente"
            search-placeholder="Buscar cliente por nome, CPF/CNPJ, telefone..."
            empty-message="Nenhum cliente encontrado"
            icon="i-lucide-user"
            item-icon="i-lucide-user"
            class="w-full"
            @update:model-value="emit('update:clientId', $event)"
            @select="(c: ClientRecord) => emit('selectClient', c)"
            @clear="emit('clearClient')"
          />
        </UFormField>

        <UFormField label="Veículo">
          <UiAsyncPaginatedSelect
            :model-value="vehicleId"
            fetch-url="/api/vehicles"
            :query-params="{ client_id: clientId || undefined }"
            :get-label="vehicleLabel"
            :selected-label="vehicleSelectedLabel"
            placeholder="Sem veículo"
            search-placeholder="Buscar por placa, marca ou modelo..."
            empty-message="Nenhum veículo encontrado"
            icon="i-lucide-car"
            item-icon="i-lucide-car"
            class="w-full"
            @update:model-value="emit('update:vehicleId', $event)"
            @select="(v: VehicleRecord) => emit('selectVehicle', v)"
            @clear="emit('clearVehicle')"
          />
        </UFormField>

        <UFormField label="Produto master" class="col-span-2">
          <div class="space-y-3">
            <div class="flex items-start gap-2">
              <ServiceOrdersMasterProductSelectInput
                :model-value="masterProductId"
                :selected-product="selectedMasterProduct"
                class="min-w-0 flex-1"
                @select="(p) => { emit('update:masterProductId', p.id); emit('selectMasterProduct', p) }"
                @clear="emit('clearMasterProduct')"
              />
              <div class="flex shrink-0 items-center gap-2">
                <UTooltip text="Novo produto master">
                  <UButton
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    @click="emit('openMasterProductEditor')"
                  />
                </UTooltip>
                <UTooltip text="Gerenciar produtos master">
                  <UButton
                    icon="i-lucide-settings-2"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    @click="emit('openMasterProductManager')"
                  />
                </UTooltip>
              </div>
            </div>

            <div v-if="selectedMasterProduct" class="rounded-xl border border-default bg-elevated/50 p-3">
              <div class="flex items-start gap-3">
                <UIcon name="i-lucide-box" class="mt-0.5 size-4 text-primary" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-highlighted">
                    {{ selectedMasterProduct.name }}
                  </p>
                  <p v-if="selectedMasterProduct.description" class="mt-1 text-sm text-muted">
                    {{ selectedMasterProduct.description }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </UFormField>
      </div>
    </div>
  </UCard>
</template>
