<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { FeedbackType, feedbackTypeLabels, feedbackTypeIcons } from '~/types/feedback'
import type { CreateFeedbackPayload } from '~/types/feedback'

// ─── Configuration ─────────────────────────────────────────────────────────────
// Adjust these constants to change upload limits across the app.
// The server enforces the same limits in server/api/feedback/upload.post.ts
const MAX_ATTACHMENTS = 5 // max files per ticket
const MAX_IMAGE_SIZE_MB = 5 // max image size in MB
const MAX_VIDEO_SIZE_MB = 10 // max video size in MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'submit': [payload: CreateFeedbackPayload]
}>()

const toast = useToast()

const schema = z.object({
  type: z.nativeEnum(FeedbackType, { message: 'Selecione o tipo' }),
  title: z.string().min(1, 'Título é obrigatório').max(200),
  description: z.string().min(1, 'Descrição é obrigatória').max(5000)
})

type Schema = z.infer<typeof schema>

const state = reactive<Schema>({
  type: FeedbackType.Bug,
  title: '',
  description: ''
})

const selectedType = ref(FeedbackType.Bug)

watch(selectedType, (val) => {
  state.type = val
})

const saving = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

interface SelectedFile {
  file: File
  preview: string | null
  name: string
  type: string
}

const selectedFiles = ref<SelectedFile[]>([])

const typeOptions = Object.values(FeedbackType).map(t => ({
  label: feedbackTypeLabels[t],
  value: t,
  icon: feedbackTypeIcons[t]
}))

function onFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files) return

  for (const file of Array.from(input.files)) {
    if (selectedFiles.value.length >= MAX_ATTACHMENTS) {
      toast.add({ title: `Máximo de ${MAX_ATTACHMENTS} arquivos por chamado`, color: 'warning' })
      break
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.add({ title: `Tipo "${file.type}" não permitido`, color: 'error' })
      continue
    }
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type)
    const maxBytes = (isVideo ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB) * 1024 * 1024
    if (file.size > maxBytes) {
      toast.add({
        title: `${file.name} muito grande`,
        description: `Máximo ${isVideo ? MAX_VIDEO_SIZE_MB + 'MB para vídeos' : MAX_IMAGE_SIZE_MB + 'MB para imagens'}`,
        color: 'error'
      })
      continue
    }
    const preview = ALLOWED_IMAGE_TYPES.includes(file.type) ? URL.createObjectURL(file) : null
    selectedFiles.value.push({ file, preview, name: file.name, type: file.type })
  }

  input.value = ''
}

function removeFile(index: number) {
  const removed = selectedFiles.value.splice(index, 1)
  if (removed[0]?.preview) URL.revokeObjectURL(removed[0].preview)
}

async function uploadFiles(): Promise<Array<{ fileName: string, fileUrl: string, fileType: string, fileSize: number }>> {
  const results: Array<{ fileName: string, fileUrl: string, fileType: string, fileSize: number }> = []
  for (const item of selectedFiles.value) {
    const formData = new FormData()
    formData.append('file', item.file)
    const result = await $fetch<{ url: string, fileName: string, fileType: string, fileSize: number }>(
      '/api/feedback/upload',
      { method: 'POST', body: formData }
    )
    results.push({ fileName: result.fileName, fileUrl: result.url, fileType: result.fileType, fileSize: result.fileSize })
  }
  return results
}

function resetForm() {
  state.type = FeedbackType.Bug
  selectedType.value = FeedbackType.Bug
  state.title = ''
  state.description = ''
  selectedFiles.value.forEach((f) => {
    if (f.preview) URL.revokeObjectURL(f.preview)
  })
  selectedFiles.value = []
}

async function onSubmit(evt: FormSubmitEvent<Schema>) {
  if (saving.value) return
  saving.value = true
  try {
    let attachments: Array<{ fileName: string, fileUrl: string, fileType: string }> = []
    if (selectedFiles.value.length > 0) {
      attachments = await uploadFiles()
    }
    const payload: CreateFeedbackPayload = {
      type: evt.data.type,
      title: evt.data.title,
      description: evt.data.description,
      attachments
    }
    emit('submit', payload)
    resetForm()
    emit('update:open', false)
  } catch {
    toast.add({ title: 'Erro ao enviar chamado', description: 'Verifique os arquivos e tente novamente.', color: 'error' })
  } finally {
    saving.value = false
  }
}

function onClose() {
  resetForm()
  emit('update:open', false)
}
</script>

<template>
  <UModal :open="props.open" title="Abrir chamado de suporte" @update:open="onClose">
    <template #body>
      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField name="type" label="Tipo">
          <USelectMenu
            v-model="selectedType"
            :items="typeOptions"
            value-key="value"
            placeholder="Selecione o tipo"
            class="w-full"
          />
        </UFormField>

        <UFormField name="title" label="Assunto">
          <UInput v-model="state.title" placeholder="Descreva resumidamente o problema" class="w-full" />
        </UFormField>

        <UFormField name="description" label="Descrição">
          <UTextarea
            v-model="state.description"
            placeholder="Explique em detalhes o que está acontecendo..."
            :rows="5"
            class="w-full"
          />
        </UFormField>

        <!-- File attachments -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">Anexos</span>
            <span class="text-xs text-muted">
              {{ selectedFiles.length }}/{{ MAX_ATTACHMENTS }} · imagens até {{ MAX_IMAGE_SIZE_MB }}MB · vídeos até {{ MAX_VIDEO_SIZE_MB }}MB
            </span>
          </div>

          <!-- Previews grid -->
          <div v-if="selectedFiles.length > 0" class="grid grid-cols-3 gap-2">
            <div
              v-for="(item, index) in selectedFiles"
              :key="index"
              class="relative aspect-square rounded-lg overflow-hidden border border-default bg-elevated"
            >
              <img
                v-if="item.preview"
                :src="item.preview"
                :alt="item.name"
                class="w-full h-full object-cover"
              >
              <div v-else class="flex flex-col items-center justify-center h-full gap-1 p-2">
                <UIcon name="i-lucide-video" class="size-6 text-muted" />
                <p class="text-[10px] text-muted truncate w-full text-center px-1">
                  {{ item.name }}
                </p>
              </div>
              <button
                type="button"
                class="absolute top-1 right-1 flex items-center justify-center size-5 rounded-full bg-black/60 hover:bg-black/80 transition-colors"
                @click="removeFile(index)"
              >
                <UIcon name="i-lucide-x" class="size-3 text-white" />
              </button>
            </div>

            <button
              v-if="selectedFiles.length < MAX_ATTACHMENTS"
              type="button"
              class="flex flex-col items-center justify-center aspect-square rounded-lg border border-dashed border-default bg-elevated hover:bg-elevated/60 transition-colors"
              @click="fileInputRef?.click()"
            >
              <UIcon name="i-lucide-plus" class="size-5 text-muted" />
            </button>
          </div>

          <!-- Drop zone (empty state) -->
          <button
            v-else
            type="button"
            class="w-full flex flex-col items-center justify-center rounded-lg border border-dashed border-default bg-elevated/40 p-6 hover:bg-elevated/70 transition-colors"
            @click="fileInputRef?.click()"
          >
            <UIcon name="i-lucide-paperclip" class="size-7 text-muted mb-2" />
            <p class="text-sm text-muted">
              Adicionar imagens ou vídeos
            </p>
            <p class="text-xs text-dimmed mt-0.5">
              JPEG, PNG, GIF, WebP, MP4, WebM, MOV
            </p>
          </button>

          <input
            ref="fileInputRef"
            type="file"
            class="hidden"
            :accept="ALLOWED_TYPES.join(',')"
            multiple
            @change="onFileSelect"
          >
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancelar"
            @click="onClose"
          />
          <UButton
            type="submit"
            label="Enviar chamado"
            :loading="saving"
            :disabled="saving"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
