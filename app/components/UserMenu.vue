<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { useAuth } from '~/composables/useAuth'

const props = defineProps<{
  collapsed?: boolean
  /** `admin`: painel da plataforma. Sem atalhos da oficina (perfil, empresa, assinatura, configurações, documentação). */
  variant?: 'app' | 'admin'
}>()

const isAdmin = computed(() => props.variant === 'admin')

const toast = useToast()
const auth = useAuth()
const workshop = useWorkshopBootstrap()
const router = useRouter()
const { state: prefs, setPrimaryColor, setNeutralColor, setColorMode } = useUserPreferences()

const colorLabels: Record<string, string> = {
  red: 'Vermelho',
  orange: 'Laranja',
  amber: 'Âmbar',
  yellow: 'Amarelo',
  lime: 'Lima',
  green: 'Verde',
  emerald: 'Esmeralda',
  teal: 'Azul-petróleo',
  cyan: 'Ciano',
  sky: 'Celeste',
  blue: 'Azul',
  indigo: 'Índigo',
  violet: 'Violeta',
  purple: 'Roxo',
  fuchsia: 'Fúcsia',
  pink: 'Rosa',
  rose: 'Rose'
}

const neutralLabels: Record<string, string> = {
  slate: 'Ardósia',
  gray: 'Cinza',
  zinc: 'Zinco',
  neutral: 'Neutro',
  stone: 'Pedra'
}

const colors = Object.keys(colorLabels)
const neutrals = Object.keys(neutralLabels)

const user = computed(() => {
  const meta = auth.user.value?.user_metadata as Record<string, string> | undefined
  const name = workshop.currentUser.value?.display_name || workshop.currentUser.value?.full_name || meta?.name || auth.user.value?.email || 'Conta'

  return {
    name,
    avatar: {
      src: meta?.avatar_url,
      alt: String(name)
    }
  }
})

const workshopLinks: DropdownMenuItem[] = [{
  label: 'Perfil',
  icon: 'i-lucide-user',
  to: '/app/settings/'
}, {
  label: 'Empresa',
  icon: 'i-lucide-building-2',
  to: '/app/settings/company'
}, {
  label: 'Assinatura',
  icon: 'i-lucide-credit-card',
  to: '/app/settings/subscription'
}, {
  label: 'Configurações',
  icon: 'i-lucide-settings',
  to: '/app/settings'
}]

const items = computed<DropdownMenuItem[][]>(() => ([[{
  type: 'label',
  label: user.value.name,
  avatar: user.value.avatar
}], ...(isAdmin.value ? [] : [workshopLinks]), [{
  label: 'Tema',
  icon: 'i-lucide-palette',
  children: [{
    label: 'Primária',
    slot: 'chip',
    chip: prefs.value.primary_color,
    content: {
      align: 'center',
      collisionPadding: 16
    },
    children: colors.map(color => ({
      label: colorLabels[color] || color,
      chip: color,
      slot: 'chip',
      checked: prefs.value.primary_color === color,
      type: 'checkbox',
      onSelect: (e: Event) => {
        e.preventDefault()
        setPrimaryColor(color)
      }
    }))
  }, {
    label: 'Neutra',
    slot: 'chip',
    chip: prefs.value.neutral_color === 'neutral' ? 'old-neutral' : prefs.value.neutral_color,
    content: {
      align: 'end',
      collisionPadding: 16
    },
    children: neutrals.map(color => ({
      label: neutralLabels[color] || color,
      chip: color === 'neutral' ? 'old-neutral' : color,
      slot: 'chip',
      type: 'checkbox',
      checked: prefs.value.neutral_color === color,
      onSelect: (e: Event) => {
        e.preventDefault()
        setNeutralColor(color)
      }
    }))
  }]
}, {
  label: 'Aparência',
  icon: 'i-lucide-sun-moon',
  children: [{
    label: 'Claro',
    icon: 'i-lucide-sun',
    type: 'checkbox',
    checked: prefs.value.color_mode === 'light',
    onSelect(e: Event) {
      e.preventDefault()
      setColorMode('light')
    }
  }, {
    label: 'Escuro',
    icon: 'i-lucide-moon',
    type: 'checkbox',
    checked: prefs.value.color_mode === 'dark',
    onSelect(e: Event) {
      e.preventDefault()
      setColorMode('dark')
    }
  }]
}], [...(isAdmin.value
  ? []
  : [{
      label: 'Documentação',
      icon: 'i-lucide-book-open',
      to: '/docs'
    }]), {
  label: 'Sair',
  icon: 'i-lucide-log-out',
  async onSelect(e) {
    e.preventDefault()

    try {
      await auth.logout()
      workshop.clear()
      toast.add({ title: 'Sessão encerrada', color: 'success' })
      await router.push('/login')
    } catch {
      toast.add({ title: 'Erro', description: 'Não foi possível sair', color: 'error' })
    }
  }
}]]))
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      v-bind="{
        ...user,
        label: collapsed ? undefined : user?.name,
        trailingIcon: collapsed ? undefined : 'i-lucide-chevrons-up-down'
      }"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :ui="{
        trailingIcon: 'text-dimmed'
      }"
    />

    <template #chip-leading="{ item }">
      <div class="inline-flex items-center justify-center shrink-0 size-5">
        <span
          class="rounded-full ring ring-bg bg-(--chip-light) dark:bg-(--chip-dark) size-2"
          :style="{
            '--chip-light': `var(--color-${(item as Record<string, string>).chip}-500)`,
            '--chip-dark': `var(--color-${(item as Record<string, string>).chip}-400)`
          }"
        />
      </div>
    </template>
  </UDropdownMenu>
</template>
