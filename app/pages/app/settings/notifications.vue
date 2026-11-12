<script setup lang="ts">
import type { NotificationPermission, NotificationPreferences, NotificationSettingsResponse } from '~/types/notifications'

definePageMeta({
  layout: 'app'
})

useSeoMeta({
  title: 'Notificações'
})

const toast = useToast()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const {
  isNative,
  refreshState,
  state: oneSignalState
} = useOneSignal()

const { data, status, refresh } = await useAsyncData(
  'notification-preferences',
  () => requestFetch<NotificationSettingsResponse>('/api/settings/notifications', { headers: requestHeaders })
)

const state = reactive<NotificationPreferences>({
  channel_in_app: true,
  channel_email: true,
  channel_web_push: false,
  channel_mobile_push: false,
  habit_reminders: true,
  weekly_digest: false,
  product_updates: true,
  important_updates: true,
  web_push_permission: 'default',
  mobile_push_permission: 'default'
})

watch(data, (newData) => {
  if (!newData)
    return

  state.channel_in_app = newData.channel_in_app
  state.channel_email = newData.channel_email
  state.channel_web_push = newData.channel_web_push
  state.channel_mobile_push = newData.channel_mobile_push
  state.habit_reminders = newData.habit_reminders
  state.weekly_digest = newData.weekly_digest
  state.product_updates = newData.product_updates
  state.important_updates = newData.important_updates
  state.web_push_permission = newData.web_push_permission
  state.mobile_push_permission = newData.mobile_push_permission
}, { immediate: true })

type ToggleField = {
  name:
    | 'channel_in_app'
    | 'channel_email'
    | 'channel_web_push'
    | 'channel_mobile_push'
    | 'habit_reminders'
    | 'weekly_digest'
    | 'product_updates'
    | 'important_updates'
  label: string
  description: string
}

const channelFields: ToggleField[] = [
  {
    name: 'channel_in_app',
    label: 'Central do app',
    description: 'Mantém avisos na central interna do AutoPro.'
  },
  {
    name: 'channel_email',
    label: 'Email',
    description: 'Receba notificações por email quando esse canal for usado.'
  },
  {
    name: 'channel_web_push',
    label: 'Web notification',
    description: 'Receba notificações no navegador e na PWA.'
  },
  {
    name: 'channel_mobile_push',
    label: 'Push no app',
    description: 'Receba push notifications no app nativo iOS/Android.'
  }
]

const topicFields: ToggleField[] = [
  {
    name: 'habit_reminders',
    label: 'Lembretes operacionais',
    description: 'Alertas sobre agenda, ordens de serviço e tarefas operacionais.'
  },
  {
    name: 'weekly_digest',
    label: 'Resumo semanal',
    description: 'Resumo periódico da operação da oficina.'
  },
  {
    name: 'product_updates',
    label: 'Atualizações do produto',
    description: 'Novidades gerais, melhorias e lançamentos.'
  },
  {
    name: 'important_updates',
    label: 'Atualizações importantes',
    description: 'Comunicados críticos de segurança, manutenção e conta.'
  }
]

const effectiveWebPermission = computed<NotificationPermission>(() => {
  return !isNative.value && oneSignalState.value.initialized && oneSignalState.value.permission !== 'unsupported'
    ? oneSignalState.value.permission
    : state.web_push_permission
})

const effectiveMobilePermission = computed<NotificationPermission>(() => {
  return isNative.value && oneSignalState.value.initialized && oneSignalState.value.permission !== 'unsupported'
    ? oneSignalState.value.permission
    : state.mobile_push_permission
})

const isSaving = ref(false)

async function savePreferences(options: { silent?: boolean } = {}) {
  if (isSaving.value)
    return

  isSaving.value = true

  try {
    await $fetch('/api/settings/notifications', {
      method: 'PUT',
      body: {
        channel_in_app: state.channel_in_app,
        channel_email: state.channel_email,
        channel_web_push: state.channel_web_push,
        channel_mobile_push: state.channel_mobile_push,
        habit_reminders: state.habit_reminders,
        weekly_digest: state.weekly_digest,
        product_updates: state.product_updates,
        important_updates: state.important_updates,
        web_push_permission: effectiveWebPermission.value,
        mobile_push_permission: effectiveMobilePermission.value
      }
    })

    await refresh()

    if (!options.silent) {
      toast.add({
        title: 'Preferências salvas',
        description: 'Suas preferências de notificação foram atualizadas.',
        color: 'success'
      })
    }
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    const message = err?.data?.statusMessage || err?.statusMessage || 'Não foi possível salvar as preferências'
    toast.add({ title: 'Erro', description: message, color: 'error' })
  } finally {
    isSaving.value = false
  }
}

async function onToggleChange() {
  await savePreferences()
}

onMounted(() => {
  void refreshState()
})
</script>

<template>
  <div v-if="status === 'pending'" class="space-y-4">
    <USkeleton class="h-20 w-full" />
    <USkeleton class="h-40 w-full" />
    <USkeleton class="h-40 w-full" />
    <USkeleton class="h-28 w-full" />
  </div>

  <template v-else>
    <UPageCard
      title="Canais"
      description="Escolha por onde o AutoPro pode falar com você."
      variant="naked"
      class="mb-4"
    />

    <UPageCard
      variant="subtle"
      :ui="{ container: 'divide-y divide-default' }"
      class="mb-4"
    >
      <UFormField
        v-for="field in channelFields"
        :key="field.name"
        :name="field.name"
        :label="field.label"
        :description="field.description"
        class="flex items-center justify-between not-last:pb-4 gap-2"
      >
        <USwitch
          v-model="state[field.name]"
          :disabled="isSaving"
          @update:model-value="onToggleChange"
        />
      </UFormField>
    </UPageCard>

    <UPageCard
      title="Tipos de notificação"
      description="Defina quais categorias você aceita receber."
      variant="naked"
      class="mb-4"
    />

    <UPageCard
      variant="subtle"
      :ui="{ container: 'divide-y divide-default' }"
      class="mb-4"
    >
      <UFormField
        v-for="field in topicFields"
        :key="field.name"
        :name="field.name"
        :label="field.label"
        :description="field.description"
        class="flex items-center justify-between not-last:pb-4 gap-2"
      >
        <USwitch
          v-model="state[field.name]"
          :disabled="isSaving"
          @update:model-value="onToggleChange"
        />
      </UFormField>
    </UPageCard>
  </template>
</template>
