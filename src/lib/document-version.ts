import type { StudyDocument } from '@/types'
import { cloneStudyDocument } from '@/lib/study-document'

/** Builds a reversible editor draft from a historical snapshot. The current
 * document identity and external-file association remain authoritative so a
 * restore can never redirect a later save to an obsolete disk path. */
export function historicalDocumentDraft(current: StudyDocument, snapshot: StudyDocument, updatedAt: string) {
  const restored = cloneStudyDocument(snapshot)
  restored.id = current.id
  restored.createdAt = current.createdAt
  restored.updatedAt = updatedAt
  if (current.externalFile) restored.externalFile = { ...current.externalFile }
  else delete restored.externalFile
  return restored
}
