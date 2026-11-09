import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont } from 'pdf-lib'

// ─── File utils ───
export function csvEscape(value: unknown) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ')
  // Injeção de fórmula (CSV injection): textos iniciados por = + - @ viram texto literal no Excel.
  // Números reais (ex.: -10) não são tocados.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function uint8ToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x2000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function textToBase64(text: string) {
  return uint8ToBase64(new TextEncoder().encode(text))
}

export function toLocalDateOnly(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ─── PDF builder ───
const PAGE_WIDTH = 841.89
const PAGE_HEIGHT = 595.28
const MARGIN_X = 28
const MARGIN_TOP = 28
const MARGIN_BOTTOM = 24
const TITLE_SIZE = 14
const SUBTITLE_SIZE = 9
const HEADER_SIZE = 8
const BODY_SIZE = 7
const ROW_HEIGHT = 15

function clipText(text: string, maxWidth: number, font: PDFFont, size: number) {
  const value = String(text || '')
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value
  const ellipsis = '...'
  let clipped = value
  while (clipped.length > 0) {
    const nextValue = `${clipped}${ellipsis}`
    if (font.widthOfTextAtSize(nextValue, size) <= maxWidth) return nextValue
    clipped = clipped.slice(0, -1)
  }
  return ellipsis
}

export async function buildTablePdfBase64({
  title,
  subtitle,
  columns,
  rows,
  footerRows,
  footerMetaRows,
  footerNotes
}: {
  title: string
  subtitle?: string
  columns: Array<{ header: string, widthRatio: number, align?: 'left' | 'right' }>
  rows: string[][]
  footerRows?: Array<{ label: string, value: string }>
  footerMetaRows?: Array<{ left?: string, right?: string }>
  footerNotes?: string[]
}) {
  const pdfDocument = await PDFDocument.create()
  const fontRegular = await pdfDocument.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDocument.embedFont(StandardFonts.HelveticaBold)
  const usableWidth = PAGE_WIDTH - MARGIN_X * 2
  const normalizedColumns = columns.map(column => ({
    ...column,
    width: usableWidth * column.widthRatio
  }))

  let page = pdfDocument.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN_TOP

  const drawHeader = () => {
    page.drawText(title, { x: MARGIN_X, y, size: TITLE_SIZE, font: fontBold, color: rgb(0.12, 0.16, 0.22) })
    y -= 16
    if (subtitle) {
      page.drawText(subtitle, { x: MARGIN_X, y, size: SUBTITLE_SIZE, font: fontRegular, color: rgb(0.34, 0.39, 0.45) })
      y -= 18
    } else {
      y -= 10
    }
    let x = MARGIN_X
    for (const column of normalizedColumns) {
      page.drawText(column.header, { x, y, size: HEADER_SIZE, font: fontBold, color: rgb(0.12, 0.16, 0.22) })
      x += column.width
    }
    y -= 6
    page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 0.8, color: rgb(0.75, 0.79, 0.84) })
    y -= 10
  }

  const addPage = () => {
    page = pdfDocument.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    y = PAGE_HEIGHT - MARGIN_TOP
    drawHeader()
  }

  drawHeader()

  for (const row of rows) {
    if (y <= MARGIN_BOTTOM + ROW_HEIGHT) addPage()
    let x = MARGIN_X
    row.forEach((cell, index) => {
      const column = normalizedColumns[index]
      if (!column) return
      const maxWidth = Math.max(8, column.width - 6)
      const clipped = clipText(String(cell ?? ''), maxWidth, fontRegular, BODY_SIZE)
      const measuredWidth = fontRegular.widthOfTextAtSize(clipped, BODY_SIZE)
      const drawX = column.align === 'right' ? x + column.width - measuredWidth - 2 : x
      page.drawText(clipped, { x: drawX, y, size: BODY_SIZE, font: fontRegular, color: rgb(0.18, 0.22, 0.27) })
      x += column.width
    })
    y -= ROW_HEIGHT
  }

  const footerRowsHeight = footerRows && footerRows.length > 0 ? ROW_HEIGHT * (footerRows.length + 1) : 0
  const footerMetaRowsHeight = footerMetaRows && footerMetaRows.length > 0 ? footerMetaRows.length * 11 : 0
  const footerNotesHeight = footerNotes && footerNotes.length > 0 ? 10 + (footerNotes.length * 11) : 0

  if ((footerRows && footerRows.length > 0) || (footerMetaRows && footerMetaRows.length > 0) || (footerNotes && footerNotes.length > 0)) {
    if (y <= MARGIN_BOTTOM + footerRowsHeight + footerMetaRowsHeight + footerNotesHeight) addPage()
  }

  if (footerRows && footerRows.length > 0) {
    y -= 8
    page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 0.6, color: rgb(0.75, 0.79, 0.84) })
    y -= 12
    for (const footerRow of footerRows) {
      page.drawText(String(footerRow.label || ''), { x: MARGIN_X, y, size: BODY_SIZE + 1, font: fontBold, color: rgb(0.12, 0.16, 0.22) })
      const valueText = String(footerRow.value || '')
      const valueWidth = fontBold.widthOfTextAtSize(valueText, BODY_SIZE + 1)
      page.drawText(valueText, { x: PAGE_WIDTH - MARGIN_X - valueWidth, y, size: BODY_SIZE + 1, font: fontBold, color: rgb(0.12, 0.16, 0.22) })
      y -= ROW_HEIGHT
    }
  }

  if (footerMetaRows && footerMetaRows.length > 0) {
    y -= 4
    for (const footerMetaRow of footerMetaRows) {
      const leftText = clipText(String(footerMetaRow.left || ''), (PAGE_WIDTH - (MARGIN_X * 2)) / 2 - 8, fontRegular, BODY_SIZE)
      const rightText = clipText(String(footerMetaRow.right || ''), (PAGE_WIDTH - (MARGIN_X * 2)) / 2 - 8, fontRegular, BODY_SIZE)

      if (leftText) {
        page.drawText(leftText, {
          x: MARGIN_X,
          y,
          size: BODY_SIZE,
          font: fontRegular,
          color: rgb(0.34, 0.39, 0.45)
        })
      }

      if (rightText) {
        const rightWidth = fontRegular.widthOfTextAtSize(rightText, BODY_SIZE)
        page.drawText(rightText, {
          x: PAGE_WIDTH - MARGIN_X - rightWidth,
          y,
          size: BODY_SIZE,
          font: fontRegular,
          color: rgb(0.34, 0.39, 0.45)
        })
      }

      y -= 11
    }
  }

  if (footerNotes && footerNotes.length > 0) {
    y -= 4
    for (const footerNote of footerNotes) {
      const noteText = clipText(String(footerNote || ''), PAGE_WIDTH - (MARGIN_X * 2), fontRegular, BODY_SIZE)
      page.drawText(noteText, {
        x: MARGIN_X,
        y,
        size: BODY_SIZE,
        font: fontRegular,
        color: rgb(0.34, 0.39, 0.45)
      })
      y -= 11
    }
  }

  const bytes = await pdfDocument.save()
  return uint8ToBase64(bytes)
}

export async function buildReportDownloadData({
  format,
  title,
  subtitle,
  fileNameBase,
  columns,
  rows,
  footerRows,
  footerMetaRows,
  footerNotes
}: {
  format: 'csv' | 'pdf'
  title: string
  subtitle?: string
  fileNameBase: string
  columns: Array<{ header: string, widthRatio?: number, align?: 'left' | 'right' }>
  rows: unknown[][]
  footerRows?: Array<{ label: string, value: string }>
  footerMetaRows?: Array<{ left?: string, right?: string }>
  footerNotes?: string[]
}) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('As colunas do relatório são obrigatórias.')
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Não há dados para exportar.')
  }

  const normalizedColumns = columns.map(column => ({
    header: String(column?.header || ''),
    widthRatio: Number(column?.widthRatio || 0) > 0 ? Number(column.widthRatio) : 1 / columns.length,
    align: (column?.align === 'right' ? 'right' : 'left') as 'left' | 'right'
  }))

  const normalizedRows = rows.map(row => (Array.isArray(row) ? row : []).map(cell => String(cell ?? '')))
  const today = toLocalDateOnly(new Date())

  if (format === 'csv') {
    const csvLines = [
      normalizedColumns.map(column => csvEscape(column.header)).join(','),
      ...normalizedRows.map(row => row.map(csvEscape).join(','))
    ]
    if (footerRows && footerRows.length > 0) {
      csvLines.push('')
      for (const footerRow of footerRows) {
        csvLines.push(`${csvEscape(footerRow.label)},${csvEscape(footerRow.value)}`)
      }
    }
    if (footerMetaRows && footerMetaRows.length > 0) {
      csvLines.push('')
      for (const footerMetaRow of footerMetaRows) {
        csvLines.push(`${csvEscape(footerMetaRow.left || '')},${csvEscape(footerMetaRow.right || '')}`)
      }
    }
    if (footerNotes && footerNotes.length > 0) {
      csvLines.push('')
      for (const footerNote of footerNotes) {
        csvLines.push(csvEscape(footerNote))
      }
    }
    const csv = csvLines.join('\n')
    return { fileName: `${fileNameBase}_${today}.csv`, contentType: 'text/csv;charset=utf-8;', base64: textToBase64(csv) }
  }

  const base64 = await buildTablePdfBase64({ title, subtitle, columns: normalizedColumns, rows: normalizedRows, footerRows, footerMetaRows, footerNotes })
  return { fileName: `${fileNameBase}_${today}.pdf`, contentType: 'application/pdf', base64 }
}
