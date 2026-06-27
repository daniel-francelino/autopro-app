<script setup lang="ts">
import type { ServiceOrderDetailFull } from '~/types/service-orders'
import type { OrganizationData } from '~/types/organization'

const props = defineProps<{
  open: boolean
  orderId: string | null
  quoteMode?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const toast = useToast()
const detail = ref<ServiceOrderDetailFull | null>(null)
const organization = ref<OrganizationData | null>(null)
const isLoading = ref(false)
const isDownloading = ref(false)
const isPrinting = ref(false)
const captureDocRef = ref<{ el: HTMLElement | null } | null>(null)
const printCleanupTargets: { iframe: HTMLIFrameElement, url: string }[] = []

watch(
  () => props.open,
  (opened) => {
    if (opened) loadData()
    else {
      detail.value = null
      organization.value = null
      cleanupPrintTargets()
    }
  }
)

async function loadData() {
  if (!props.orderId) return

  isLoading.value = true
  detail.value = null

  try {
    const [detailResponse, organizationResponse] = await Promise.all([
      $fetch<{ data: ServiceOrderDetailFull }>(
        `/api/service-orders/${props.orderId}`
      ),
      $fetch<OrganizationData>('/api/organizations')
    ])

    detail.value = detailResponse.data
    organization.value = organizationResponse
  } catch (error: unknown) {
    const err = error as {
      data?: { statusMessage?: string }
      statusMessage?: string
    }
    toast.add({
      title: 'Erro ao carregar orçamento',
      description:
        err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
    emit('update:open', false)
  } finally {
    isLoading.value = false
  }
}

function close() {
  emit('update:open', false)
}

function sanitizeFileNamePart(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function buildPdfBlob(el: HTMLElement): Promise<Blob> {
  const [{ toPng }, { PDFDocument }] = await Promise.all([
    import('html-to-image'),
    import('pdf-lib')
  ])

  const PIXEL_RATIO = 2
  // Must match PAGE_H constant in DocumentPrint.vue
  const PAGE_PX_H = 1123

  const dataUrl = await toPng(el, {
    pixelRatio: PIXEL_RATIO,
    cacheBust: true,
    backgroundColor: '#ffffff'
  })

  const fullImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })

  // Each page in DocumentPrint is exactly PAGE_PX_H px tall;
  // at PIXEL_RATIO=2 each page stripe in the PNG is PAGE_PX_H*2 px tall.
  const stripeH = PAGE_PX_H * PIXEL_RATIO
  const stripeW = fullImg.naturalWidth
  const numPages = Math.max(1, Math.round(fullImg.naturalHeight / stripeH))

  const PDF_W = 595.28
  const PDF_H = 841.89

  const pdf = await PDFDocument.create()

  for (let i = 0; i < numPages; i++) {
    // Slice exactly one page-stripe from the full image
    const canvas = document.createElement('canvas')
    canvas.width = stripeW
    canvas.height = stripeH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, stripeW, stripeH)
    ctx.drawImage(fullImg, 0, i * stripeH, stripeW, stripeH, 0, 0, stripeW, stripeH)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
        'image/png'
      )
    })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const pdfImg = await pdf.embedPng(bytes)
    const page = pdf.addPage([PDF_W, PDF_H])
    // Full-bleed: the document already has its own internal padding
    page.drawImage(pdfImg, { x: 0, y: 0, width: PDF_W, height: PDF_H })
  }

  const pdfBytes = await pdf.save()
  return new Blob(
    [pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer],
    { type: 'application/pdf' }
  )
}

async function downloadPdf() {
  const el = captureDocRef.value?.el
  if (!el || !detail.value || isDownloading.value) return

  isDownloading.value = true

  try {
    const blob = await buildPdfBlob(el)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const clientPart = sanitizeFileNamePart(detail.value.client?.name) || 'Cliente'
    const numberPart = sanitizeFileNamePart(detail.value.order.number) || 'OS'
    const datePart = new Date().toISOString().slice(0, 10)

    link.href = url
    link.download = `${clientPart}_${numberPart}_${datePart}.pdf`
    link.click()
    URL.revokeObjectURL(url)

    toast.add({ title: 'PDF gerado com sucesso', color: 'success' })
  } catch {
    toast.add({
      title: 'Erro ao gerar PDF',
      description: 'Não foi possível gerar o documento do orçamento.',
      color: 'error'
    })
  } finally {
    isDownloading.value = false
  }
}

async function printPdf() {
  const el = captureDocRef.value?.el
  if (!el || !detail.value || isPrinting.value) return

  isPrinting.value = true

  try {
    const blob = await buildPdfBlob(el)
    const url = URL.createObjectURL(blob)

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.inset = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.src = url

    iframe.addEventListener('load', () => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    })

    document.body.appendChild(iframe)
    printCleanupTargets.push({ iframe, url })
  } catch {
    toast.add({
      title: 'Erro ao preparar impressão',
      description: 'Não foi possível preparar o documento para impressão.',
      color: 'error'
    })
  } finally {
    isPrinting.value = false
  }
}

function cleanupPrintTargets() {
  for (const { iframe, url } of printCleanupTargets) {
    iframe.remove()
    URL.revokeObjectURL(url)
  }
  printCleanupTargets.length = 0
}

onUnmounted(cleanupPrintTargets)
</script>

<template>
  <UModal
    :open="open"
    :ui="{
      overlay: 'bg-default/92 backdrop-blur-sm',
      content:
        'sm:max-h-[100dvh] max-h-[100dvh] m-0 max-w-none w-screen h-dvh rounded-none flex flex-col overflow-hidden',
      header: 'p-0 border-b border-default shrink-0',
      body: 'flex-1 min-h-0 overflow-y-auto p-0 bg-[linear-gradient(180deg,rgba(var(--ui-bg),1),rgba(var(--ui-bg-elevated),0.92))]'
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #header>
      <div
        class="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-6 lg:py-5 w-full justify-between"
      >
        <div class="min-w-0 space-y-3">
          <div class="space-y-1.5">
            <p class="font-semibold uppercase tracking-[0.22em] text-primary/80">
              {{ quoteMode !== false ? 'Visualização do Orçamento' : 'Visualização da OS' }}
            </p>
            <div
              class="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between"
            >
              <div class="min-w-0">
                <h1 class="truncate text-xl font-bold text-highlighted lg:text-2xl">
                  {{
                    detail?.order.number
                      ? `OS #${detail.order.number}`
                      : quoteMode !== false
                        ? 'Orçamento de serviços'
                        : 'Ordem de Serviço'
                  }}
                </h1>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-start justify-end">
          <div
            class="flex w-full max-w-[360px] items-center justify-end gap-2 rounded-2xl p-2 lg:w-auto"
          >
            <UButton
              label="Imprimir"
              icon="i-lucide-printer"
              color="primary"
              variant="outline"
              size="sm"
              class="flex-1 lg:flex-none"
              :loading="isPrinting"
              :disabled="isLoading || !detail"
              @click="printPdf"
            />
            <UButton
              label="Baixar PDF"
              icon="i-lucide-download"
              color="primary"
              size="sm"
              class="flex-1 lg:flex-none"
              :loading="isDownloading"
              :disabled="isLoading || !detail"
              @click="downloadPdf"
            />
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              square
              @click="close"
            />
          </div>
        </div>
      </div>
    </template>

    <template #body>
      <div v-if="isLoading" class="space-y-4 p-6 lg:p-8">
        <USkeleton
          class="mx-auto h-[1120px] w-full max-w-[860px] rounded-[32px]"
        />
      </div>

      <div v-else-if="detail" class="px-4 py-6 lg:px-8 lg:py-8">
        <div class="mx-auto max-w-[900px]">
          <ServiceOrdersQuoteDocumentPreview
            :detail="detail"
            :organization="organization"
            :quote-mode="quoteMode"
          />
        </div>
      </div>
    </template>
  </UModal>

  <!-- Hidden fixed-size document used exclusively for PDF capture -->
  <div
    v-if="detail"
    style="position:fixed; top:-9999px; left:-9999px; pointer-events:none;"
    aria-hidden="true"
  >
    <ServiceOrdersQuoteDocumentPrint
      ref="captureDocRef"
      :detail="detail"
      :organization="organization"
      :quote-mode="quoteMode"
    />
  </div>
</template>
