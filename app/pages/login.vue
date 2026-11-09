<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { useAuth } from '~/composables/useAuth'
import { useWorkshopBootstrap } from '~/composables/useWorkshopBootstrap'
import { resolveAuthenticatedDestination } from '~/middleware/auth.global'

definePageMeta({
  layout: 'auth'
})

useSeoMeta({
  title: 'Entrar',
  description: 'Acesse sua conta para continuar'
})

const toast = useToast()
const showApiError = useApiErrorToast()
const auth = useAuth()
const bootstrap = useWorkshopBootstrap()
const router = useRouter()
const rememberedEmail = useCookie<string | null>('remembered-login-email', {
  default: () => null,
  maxAge: 60 * 60 * 24 * 90,
  sameSite: 'lax'
})

const submitting = ref(false)

const fields = [{
  name: 'email',
  type: 'text' as const,
  label: 'Email',
  placeholder: 'Digite seu email',
  defaultValue: rememberedEmail.value ?? '',
  required: true
}, {
  name: 'password',
  label: 'Senha',
  type: 'password' as const,
  placeholder: 'Digite sua senha'
}, {
  name: 'remember',
  label: 'Lembrar de mim',
  type: 'checkbox' as const,
  defaultValue: true
}]

const schema = z.object({
  email: z.email('Email inválido'),
  password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres'),
  remember: z.boolean().optional()
})

type Schema = z.input<typeof schema>

async function onSubmit(payload?: FormSubmitEvent<Schema>) {
  if (!payload) return
  if (submitting.value) return
  submitting.value = true

  if (payload.data.remember ?? true)
    rememberedEmail.value = payload.data.email
  else
    rememberedEmail.value = null

  try {
    await auth.login({
      email: payload.data.email,
      password: payload.data.password,
      remember: payload.data.remember ?? true
    })

    await bootstrap.fetchBootstrap(true)

    toast.add({
      title: 'Login realizado',
      description: 'Bem-vindo de volta!',
      color: 'success'
    })

    await router.push(resolveAuthenticatedDestination(bootstrap))
  } catch (error: unknown) {
    showApiError(error, 'Erro', 'Não foi possível entrar')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UAuthForm
    :fields="fields"
    :schema="schema"
    :loading="submitting"
    :disabled="submitting"
    title="Bem-vindo de volta"
    icon="i-lucide-lock"
    @submit="onSubmit"
  >
    <template #description>
      Não tem uma conta? <ULink
        to="/signup"
        class="text-primary font-medium"
      >Crie sua conta</ULink>.
    </template>

    <template #password-hint>
      <ULink
        to="/forgot-password"
        class="text-primary font-medium"
        tabindex="-1"
      >Esqueceu a senha?</ULink>
    </template>

    <template #footer>
      Ao entrar, você concorda com nossos <ULink
        to="/"
        class="text-primary font-medium"
      >Termos de Serviço</ULink>.
    </template>
  </UAuthForm>
</template>
