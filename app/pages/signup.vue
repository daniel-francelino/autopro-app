<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { useAuth } from '~/composables/useAuth'

definePageMeta({
  layout: 'auth'
})

useSeoMeta({
  title: 'Criar conta',
  description: 'Crie sua conta para começar'
})

const toast = useToast()
const auth = useAuth()
const router = useRouter()

const submitting = ref(false)

const fields = [{
  name: 'name',
  type: 'text' as const,
  label: 'Nome',
  placeholder: 'Digite seu nome'
}, {
  name: 'email',
  type: 'text' as const,
  label: 'Email',
  placeholder: 'Digite seu email'
}, {
  name: 'password',
  label: 'Senha',
  type: 'password' as const,
  placeholder: 'Crie uma senha'
}]

const schema = z.object({
  name: z.string().min(1, 'O nome é obrigatório'),
  email: z.email('Email inválido'),
  password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres')
})

type Schema = z.output<typeof schema>
type FetchErrorLike = {
  data?: {
    statusMessage?: string
  }
  statusMessage?: string
}

function getSignupErrorMessage(error: FetchErrorLike) {
  const rawMessage = error?.data?.statusMessage || error?.statusMessage || ''

  if (rawMessage.toLowerCase().includes('email rate limit exceeded'))
    return 'Aguarde uma hora e tente criar a conta novamente.'

  return rawMessage || 'Não foi possível criar a conta'
}

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  if (submitting.value) return

  submitting.value = true

  try {
    const response = await auth.signup({
      name: payload.data.name,
      email: payload.data.email,
      password: payload.data.password
    })

    if (!response.session) {
      toast.add({
        title: 'Conta criada',
        description: 'Verifique seu email para confirmar o cadastro.',
        color: 'success'
      })
      await router.push('/login')
      return
    }

    toast.add({
      title: 'Conta criada',
      description: 'Você já está logado.',
      color: 'success'
    })
    await router.push('/subscription')
  } catch (error: unknown) {
    const err = error as FetchErrorLike

    toast.add({
      title: 'Erro',
      description: getSignupErrorMessage(err),
      color: 'error'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UAuthForm
    :fields="fields"
    :schema="schema"
    title="Crie sua conta"
    :submit="{ label: 'Criar conta' }"
    :loading="submitting"
    :disabled="submitting"
    @submit="onSubmit"
  >
    <template #description>
      Já tem uma conta? <ULink
        to="/login"
        class="text-primary font-medium"
      >Entrar</ULink>.
    </template>

    <template #footer>
      Ao criar a conta, você concorda com nossos <ULink
        to="/"
        class="text-primary font-medium"
      >Termos de Serviço</ULink>.
    </template>
  </UAuthForm>
</template>
