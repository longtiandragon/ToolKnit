import type { StudyDocument } from '@/types'
import { cloneStudyDocument } from '@/lib/study-document'

export type DesktopDocumentRecoveryChange =
  | { kind: 'save'; document: StudyDocument }
  | { kind: 'delete'; id: string }
  | { kind: 'replace'; documents: StudyDocument[] }

export interface DesktopDocumentRecovery {
  exists: boolean
  /** The v1 emergency snapshot, kept readable during migration. */
  snapshot?: StudyDocument[]
  /** v2 stores only writes which have not reached SQLite yet. */
  changes: DesktopDocumentRecoveryChange[]
}

// The desktop Vault is the durable home for Markdown. This is only a
// write-ahead bridge for a small number of changes that have not reached
// SQLite yet, so never let it become another multi-megabyte document store.
// Keep the limit well below common WebView localStorage quotas, which vary by
// platform and may already contain settings or an older browser-mode backup.
export const DESKTOP_DOCUMENT_RECOVERY_MAX_CHARS = 512 * 1024

function isDocument(value: unknown): value is StudyDocument {
  if (!value || typeof value !== 'object') return false
  const document = value as Partial<StudyDocument>
  return typeof document.id === 'string'
    && typeof document.title === 'string'
    && (document.kind === 'note' || document.kind === 'question')
    && typeof document.subject === 'string'
    && typeof document.content === 'string'
    && typeof document.createdAt === 'string'
    && typeof document.updatedAt === 'string'
}

function cloneChange(change: DesktopDocumentRecoveryChange): DesktopDocumentRecoveryChange {
  if (change.kind === 'save') return { kind: 'save', document: cloneStudyDocument(change.document) }
  if (change.kind === 'delete') return { kind: 'delete', id: change.id }
  return { kind: 'replace', documents: change.documents.map(cloneStudyDocument) }
}

function isChange(value: unknown): value is DesktopDocumentRecoveryChange {
  if (!value || typeof value !== 'object') return false
  const change = value as Partial<DesktopDocumentRecoveryChange>
  if (change.kind === 'delete') return typeof change.id === 'string'
  if (change.kind === 'save') return isDocument(change.document)
  return change.kind === 'replace' && Array.isArray(change.documents) && change.documents.every(isDocument)
}

/** Reads both the old complete snapshot and the new small write-ahead journal. */
export function parseDesktopDocumentRecovery(raw: string | null): DesktopDocumentRecovery {
  if (!raw) return { exists: false, changes: [] }
  try {
    const parsed = JSON.parse(raw) as { documents?: unknown; changes?: unknown }
    if (Array.isArray(parsed.documents) && parsed.documents.every(isDocument)) {
      return { exists: true, snapshot: parsed.documents.map(cloneStudyDocument), changes: [] }
    }
    if (Array.isArray(parsed.changes) && parsed.changes.length && parsed.changes.every(isChange)) {
      return { exists: true, changes: parsed.changes.map(cloneChange) }
    }
  } catch { /* leave a malformed entry untouched for manual inspection */ }
  return { exists: false, changes: [] }
}

/**
 * Coalesce repeated writes to the same document after the latest full replace.
 * This keeps saving one long note proportional to that note, not the vault.
 */
export function appendDocumentRecoveryChange(changes: DesktopDocumentRecoveryChange[], next: DesktopDocumentRecoveryChange) {
  const copy = changes.map(cloneChange)
  const normalized = cloneChange(next)
  if (normalized.kind === 'replace') return [normalized]
  const start = Math.max(0, copy.map((change) => change.kind).lastIndexOf('replace') + 1)
  const id = normalized.kind === 'delete' ? normalized.id : normalized.document.id
  let index = -1
  for (let candidateIndex = copy.length - 1; candidateIndex >= start; candidateIndex -= 1) {
    const change = copy[candidateIndex]
    if (change.kind !== 'replace' && (change.kind === 'delete' ? change.id : change.document.id) === id) {
      index = candidateIndex
      break
    }
  }
  if (index >= start) copy[index] = normalized
  else copy.push(normalized)
  return copy
}

export function serializeDesktopDocumentRecovery(changes: DesktopDocumentRecoveryChange[], savedAt: string) {
  return JSON.stringify({ version: 2, savedAt, changes: changes.map(cloneChange) })
}

/**
 * Returns no payload when the write-ahead journal would be too large for the
 * renderer's synchronous storage.  The caller can then remove any older
 * journal instead of risking a stale change overwriting the newer Vault copy
 * after restart.  Estimate first to avoid stringifying a multi-MB note during
 * a save keystroke; retain a final exact check for large metadata fields.
 */
export function serializeDesktopDocumentRecoveryBounded(changes: DesktopDocumentRecoveryChange[], savedAt: string, maxChars = DESKTOP_DOCUMENT_RECOVERY_MAX_CHARS) {
  const contentChars = changes.reduce((total, change) => {
    if (change.kind === 'save') return total + change.document.content.length
    if (change.kind === 'replace') return total + change.documents.reduce((sum, document) => sum + document.content.length, 0)
    return total
  }, 0)
  if (contentChars > maxChars) return undefined
  const serialized = serializeDesktopDocumentRecovery(changes, savedAt)
  return serialized.length <= maxChars ? serialized : undefined
}

/** Replays an incomplete journal after SQLite has opened successfully. */
export function replayDesktopDocumentRecovery(base: StudyDocument[], changes: DesktopDocumentRecoveryChange[]) {
  let documents = base.map(cloneStudyDocument)
  for (const change of changes) {
    if (change.kind === 'replace') { documents = change.documents.map(cloneStudyDocument); continue }
    const id = change.kind === 'delete' ? change.id : change.document.id
    const index = documents.findIndex((document) => document.id === id)
    if (change.kind === 'delete') {
      if (index >= 0) documents.splice(index, 1)
    } else if (index >= 0) documents[index] = cloneStudyDocument(change.document)
    else documents.unshift(cloneStudyDocument(change.document))
  }
  return documents
}
