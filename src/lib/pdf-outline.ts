import { cleanOutputName } from './file-tools'

export const PDF_OUTLINE_MAX_ITEMS = 4096
export const PDF_OUTLINE_MAX_DEPTH = 32
export const PDF_OUTLINE_MAX_TITLE_CHARS = 512
export const PDF_OUTLINE_MAX_URL_CHARS = 2048

export interface PdfOutlineItem {
  title: string
  url?: string
  newWindow?: boolean
  bold?: boolean
  italic?: boolean
  color?: string
  hasDestination: boolean
  items: PdfOutlineItem[]
}

export interface PdfOutlineReport {
  version: 1
  fileName: string
  itemCount: number
  truncated: boolean
  items: PdfOutlineItem[]
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function colorHex(value: unknown) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return undefined
  return `#${value.map((item) => Math.max(0, Math.min(255, Math.round(item as number))).toString(16).padStart(2, '0')).join('')}`
}

export function buildPdfOutlineReport(fileName: string, outline: unknown) {
  const state = { count: 0, truncated: false }
  const normalize = (nodes: unknown, depth: number): PdfOutlineItem[] => {
    if (!Array.isArray(nodes)) return []
    if (depth > PDF_OUTLINE_MAX_DEPTH) {
      state.truncated = true
      return []
    }
    const items: PdfOutlineItem[] = []
    for (const raw of nodes) {
      if (state.count >= PDF_OUTLINE_MAX_ITEMS) {
        state.truncated = true
        break
      }
      const node = recordOf(raw) ?? {}
      state.count += 1
      const title = typeof node.title === 'string' && node.title.trim() ? node.title.trim().slice(0, PDF_OUTLINE_MAX_TITLE_CHARS) : '未命名书签'
      const url = typeof node.url === 'string' && node.url.trim() ? node.url.trim().slice(0, PDF_OUTLINE_MAX_URL_CHARS) : undefined
      items.push({
        title,
        ...(url ? { url } : {}),
        ...(typeof node.newWindow === 'boolean' ? { newWindow: node.newWindow } : {}),
        ...(typeof node.bold === 'boolean' ? { bold: node.bold } : {}),
        ...(typeof node.italic === 'boolean' ? { italic: node.italic } : {}),
        ...(colorHex(node.color) ? { color: colorHex(node.color) } : {}),
        hasDestination: node.dest !== undefined && node.dest !== null,
        items: normalize(node.items, depth + 1),
      })
    }
    return items
  }

  const items = normalize(outline, 0)
  const report: PdfOutlineReport = { version: 1, fileName, itemCount: state.count, truncated: state.truncated, items }
  return JSON.stringify(report, null, 2)
}

export function pdfOutlineOutputName(sourceName: string) {
  return `${cleanOutputName(sourceName)}-bookmarks.json`
}
