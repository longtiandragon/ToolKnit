import type { VocabularyEntry } from '@/types'
import { cloneVocabularyEntry } from '@/lib/vocabulary'

export type DesktopVocabularyRecoveryChange =
  | { kind: 'save'; entry: VocabularyEntry }
  | { kind: 'delete'; id: string }
  | { kind: 'replace'; entries: VocabularyEntry[] }

export interface DesktopVocabularyRecovery {
  exists: boolean
  /** The original all-entry emergency snapshot remains readable. */
  snapshot?: VocabularyEntry[]
  /** v2 contains only mutations which have not reached SQLite yet. */
  changes: DesktopVocabularyRecoveryChange[]
}

// A word can carry many meanings, examples and inflections. The desktop Vault
// remains its durable owner; this browser journal only bridges a few writes
// that have not reached SQLite yet, so it must never grow into another large
// vocabulary store in synchronous WebView storage.
export const DESKTOP_VOCABULARY_RECOVERY_MAX_CHARS = 512 * 1024

function isVocabularyEntry(value: unknown): value is VocabularyEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<VocabularyEntry>
  return typeof entry.id === 'string'
    && typeof entry.lemma === 'string'
    && typeof entry.language === 'string'
    && Array.isArray(entry.senses)
}

function cloneChange(change: DesktopVocabularyRecoveryChange): DesktopVocabularyRecoveryChange {
  if (change.kind === 'save') return { kind: 'save', entry: cloneVocabularyEntry(change.entry) }
  if (change.kind === 'delete') return { kind: 'delete', id: change.id }
  return { kind: 'replace', entries: change.entries.map(cloneVocabularyEntry) }
}

function isChange(value: unknown): value is DesktopVocabularyRecoveryChange {
  if (!value || typeof value !== 'object') return false
  const change = value as Partial<DesktopVocabularyRecoveryChange>
  if (change.kind === 'delete') return typeof change.id === 'string'
  if (change.kind === 'save') return isVocabularyEntry(change.entry)
  return change.kind === 'replace' && Array.isArray(change.entries) && change.entries.every(isVocabularyEntry)
}

/** Reads both the old complete snapshot and the new compact write-ahead journal. */
export function parseDesktopVocabularyRecovery(raw: string | null): DesktopVocabularyRecovery {
  if (!raw) return { exists: false, changes: [] }
  try {
    const parsed = JSON.parse(raw) as { vocabulary?: unknown; changes?: unknown }
    if (Array.isArray(parsed.vocabulary) && parsed.vocabulary.every(isVocabularyEntry)) {
      return { exists: true, snapshot: parsed.vocabulary.map(cloneVocabularyEntry), changes: [] }
    }
    if (Array.isArray(parsed.changes) && parsed.changes.length && parsed.changes.every(isChange)) {
      return { exists: true, changes: parsed.changes.map(cloneChange) }
    }
  } catch { /* Keep malformed recovery data available for manual inspection. */ }
  return { exists: false, changes: [] }
}

/** Coalesce repeated writes to one word after the latest bulk replacement. */
export function appendVocabularyRecoveryChange(changes: DesktopVocabularyRecoveryChange[], next: DesktopVocabularyRecoveryChange) {
  const copy = changes.map(cloneChange)
  const normalized = cloneChange(next)
  if (normalized.kind === 'replace') return [normalized]
  const start = Math.max(0, copy.map((change) => change.kind).lastIndexOf('replace') + 1)
  const id = normalized.kind === 'delete' ? normalized.id : normalized.entry.id
  let index = -1
  for (let candidateIndex = copy.length - 1; candidateIndex >= start; candidateIndex -= 1) {
    const change = copy[candidateIndex]
    if (change.kind !== 'replace' && (change.kind === 'delete' ? change.id : change.entry.id) === id) {
      index = candidateIndex
      break
    }
  }
  if (index >= start) copy[index] = normalized
  else copy.push(normalized)
  return copy
}

export function serializeDesktopVocabularyRecovery(changes: DesktopVocabularyRecoveryChange[], savedAt: string) {
  return JSON.stringify({ version: 2, savedAt, changes: changes.map(cloneChange) })
}

function estimateVocabularyEntryChars(entry: VocabularyEntry) {
  let chars = entry.id.length + entry.lemma.length + entry.language.length
    + (entry.pronunciation?.length ?? 0) + entry.createdAt.length + entry.updatedAt.length + 160
  for (const [form, value] of Object.entries(entry.forms)) chars += form.length + value.length + 16
  for (const sense of entry.senses) {
    chars += sense.id.length + sense.partOfSpeech.length + sense.definition.length + 224
    for (const example of sense.examples) chars += example.length + 8
    for (const collocation of sense.collocations) chars += collocation.length + 8
    for (const synonym of sense.synonyms) chars += synonym.length + 8
  }
  return chars
}

function estimateVocabularyRecoveryChars(changes: DesktopVocabularyRecoveryChange[]) {
  return changes.reduce((total, change) => {
    if (change.kind === 'delete') return total + change.id.length + 56
    if (change.kind === 'save') return total + estimateVocabularyEntryChars(change.entry)
    return total + change.entries.reduce((sum, entry) => sum + estimateVocabularyEntryChars(entry), 64)
  }, 64)
}

/**
 * Avoid serializing a giant word journal during a save. The estimate catches
 * typical large examples before JSON work; the exact check still protects
 * escaped strings and future metadata fields.
 */
export function serializeDesktopVocabularyRecoveryBounded(changes: DesktopVocabularyRecoveryChange[], savedAt: string, maxChars = DESKTOP_VOCABULARY_RECOVERY_MAX_CHARS) {
  if (estimateVocabularyRecoveryChars(changes) > maxChars) return undefined
  const serialized = serializeDesktopVocabularyRecovery(changes, savedAt)
  return serialized.length <= maxChars ? serialized : undefined
}

/** Replays outstanding word writes after SQLite has opened successfully. */
export function replayDesktopVocabularyRecovery(base: VocabularyEntry[], changes: DesktopVocabularyRecoveryChange[]) {
  let entries = base.map(cloneVocabularyEntry)
  for (const change of changes) {
    if (change.kind === 'replace') { entries = change.entries.map(cloneVocabularyEntry); continue }
    const id = change.kind === 'delete' ? change.id : change.entry.id
    const index = entries.findIndex((entry) => entry.id === id)
    if (change.kind === 'delete') {
      if (index >= 0) entries.splice(index, 1)
    } else if (index >= 0) entries[index] = cloneVocabularyEntry(change.entry)
    else entries.unshift(cloneVocabularyEntry(change.entry))
  }
  return entries
}
