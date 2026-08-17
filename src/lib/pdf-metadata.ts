import { cleanOutputName } from './file-tools'

export const PDF_METADATA_MAX_KEYS = 64
export const PDF_METADATA_MAX_VALUE_CHARS = 1024
export const PDF_METADATA_MAX_PAGES = 512

export interface PdfMetadataPage {
  page: number
  width: number
  height: number
  rotation: number
}

export interface PdfMetadataReport {
  version: 1
  fileName: string
  pageCount: number
  fingerprints: string[]
  info: Record<string, string | number | boolean>
  metadata: Record<string, string | number | boolean>
  permissions: number[] | null
  pages: PdfMetadataPage[]
  pagesTruncated: boolean
}

interface PdfMetadataSnapshot {
  pageCount: number
  fingerprints?: unknown
  info?: unknown
  metadata?: unknown
  permissions?: unknown
  pages?: unknown
}

type SafeScalar = string | number | boolean

function safeString(value: unknown, max = PDF_METADATA_MAX_VALUE_CHARS) {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return normalized ? normalized.slice(0, max) : undefined
}

function safeScalar(value: unknown): SafeScalar | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return safeString(value)
}

function safeRecord(value: unknown) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const entries: [string, SafeScalar][] = []
  for (const [key, raw] of Object.entries(record)) {
    if (entries.length >= PDF_METADATA_MAX_KEYS) break
    const safeKey = safeString(key, 160)
    const scalar = safeScalar(raw)
    if (!safeKey || scalar === undefined) continue
    entries.push([safeKey, scalar])
  }
  return Object.fromEntries(entries)
}

function safeFingerprints(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => safeString(item, 256))
    .filter((item): item is string => Boolean(item))
    .slice(0, 4)
}

function safePermissions(value: unknown) {
  if (!Array.isArray(value)) return null
  return value
    .filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 0)
    .slice(0, 32)
}

function safePages(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, PDF_METADATA_MAX_PAGES).flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const page = item as Record<string, unknown>
    const width = typeof page.width === 'number' && Number.isFinite(page.width) ? Math.max(0, Math.round(page.width * 100) / 100) : 0
    const height = typeof page.height === 'number' && Number.isFinite(page.height) ? Math.max(0, Math.round(page.height * 100) / 100) : 0
    const rotation = typeof page.rotation === 'number' && Number.isFinite(page.rotation) ? Math.round(page.rotation) : 0
    return [{ page: index + 1, width, height, rotation }]
  })
}

export function buildPdfMetadataReport(fileName: string, snapshot: PdfMetadataSnapshot) {
  const pageCount = Number.isInteger(snapshot.pageCount) ? Math.max(0, snapshot.pageCount) : 0
  const pages = safePages(snapshot.pages)
  const report: PdfMetadataReport = {
    version: 1,
    fileName,
    pageCount,
    fingerprints: safeFingerprints(snapshot.fingerprints),
    info: safeRecord(snapshot.info),
    metadata: safeRecord(snapshot.metadata),
    permissions: safePermissions(snapshot.permissions),
    pages,
    pagesTruncated: pageCount > pages.length,
  }
  return JSON.stringify(report, null, 2)
}

export function pdfMetadataOutputName(sourceName: string) {
  return `${cleanOutputName(sourceName)}-metadata.json`
}
