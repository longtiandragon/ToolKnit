import type { EntityRelation } from '@/types'

export type DesktopRelationRecoveryChange =
  | { kind: 'save'; relation: EntityRelation }
  | { kind: 'delete'; relation: EntityRelation }
  | { kind: 'replace'; relations: EntityRelation[] }

export interface DesktopRelationRecovery {
  exists: boolean
  /** The original all-relation emergency snapshot remains readable. */
  snapshot?: EntityRelation[]
  /** v2 contains only mutations which have not reached SQLite yet. */
  changes: DesktopRelationRecoveryChange[]
}

// Relations are lightweight, but a bulk import can still contain thousands of
// edges. Keep the recovery bridge comfortably below WebView storage quotas.
export const DESKTOP_RELATION_RECOVERY_MAX_CHARS = 256 * 1024

function isRelation(value: unknown): value is EntityRelation {
  if (!value || typeof value !== 'object') return false
  const relation = value as Partial<EntityRelation>
  return typeof relation.fromId === 'string'
    && typeof relation.toId === 'string'
    && ['related', 'prerequisite', 'variation'].includes(String(relation.relationType))
    && typeof relation.createdAt === 'string'
}

function cloneRelation(relation: EntityRelation): EntityRelation {
  return { ...relation }
}

function cloneChange(change: DesktopRelationRecoveryChange): DesktopRelationRecoveryChange {
  if (change.kind === 'replace') return { kind: 'replace', relations: change.relations.map(cloneRelation) }
  return { kind: change.kind, relation: cloneRelation(change.relation) }
}

function isChange(value: unknown): value is DesktopRelationRecoveryChange {
  if (!value || typeof value !== 'object') return false
  const change = value as Partial<DesktopRelationRecoveryChange>
  if (change.kind === 'save' || change.kind === 'delete') return isRelation(change.relation)
  return change.kind === 'replace' && Array.isArray(change.relations) && change.relations.every(isRelation)
}

function relationKey(relation: EntityRelation) {
  return `${relation.fromId}\u0000${relation.toId}\u0000${relation.relationType}`
}

/** Reads both the old complete snapshot and the new compact write-ahead journal. */
export function parseDesktopRelationRecovery(raw: string | null): DesktopRelationRecovery {
  if (!raw) return { exists: false, changes: [] }
  try {
    const parsed = JSON.parse(raw) as { relations?: unknown; changes?: unknown }
    if (Array.isArray(parsed.relations) && parsed.relations.every(isRelation)) {
      return { exists: true, snapshot: parsed.relations.map(cloneRelation), changes: [] }
    }
    if (Array.isArray(parsed.changes) && parsed.changes.length && parsed.changes.every(isChange)) {
      return { exists: true, changes: parsed.changes.map(cloneChange) }
    }
  } catch { /* Keep malformed recovery data available for manual inspection. */ }
  return { exists: false, changes: [] }
}

/** Coalesce repeated writes to the same relation after the latest replacement. */
export function appendRelationRecoveryChange(changes: DesktopRelationRecoveryChange[], next: DesktopRelationRecoveryChange) {
  const copy = changes.map(cloneChange)
  const normalized = cloneChange(next)
  if (normalized.kind === 'replace') return [normalized]
  const start = Math.max(0, copy.map((change) => change.kind).lastIndexOf('replace') + 1)
  const key = relationKey(normalized.relation)
  let index = -1
  for (let candidateIndex = copy.length - 1; candidateIndex >= start; candidateIndex -= 1) {
    const change = copy[candidateIndex]
    if (change.kind !== 'replace' && relationKey(change.relation) === key) {
      index = candidateIndex
      break
    }
  }
  if (index >= start) copy[index] = normalized
  else copy.push(normalized)
  return copy
}

export function serializeDesktopRelationRecovery(changes: DesktopRelationRecoveryChange[], savedAt: string) {
  return JSON.stringify({ version: 2, savedAt, changes: changes.map(cloneChange) })
}

function estimateRelationChars(relation: EntityRelation) {
  return relation.fromId.length + relation.toId.length + relation.relationType.length + relation.createdAt.length + 64
}

function estimateRelationRecoveryChars(changes: DesktopRelationRecoveryChange[]) {
  return changes.reduce((total, change) => {
    if (change.kind === 'replace') return total + change.relations.reduce((sum, relation) => sum + estimateRelationChars(relation), 64)
    return total + estimateRelationChars(change.relation)
  }, 64)
}

/** Returns no payload rather than synchronously serializing a huge edge list. */
export function serializeDesktopRelationRecoveryBounded(changes: DesktopRelationRecoveryChange[], savedAt: string, maxChars = DESKTOP_RELATION_RECOVERY_MAX_CHARS) {
  if (estimateRelationRecoveryChars(changes) > maxChars) return undefined
  const serialized = serializeDesktopRelationRecovery(changes, savedAt)
  return serialized.length <= maxChars ? serialized : undefined
}

/** Replays outstanding relation writes after SQLite has opened successfully. */
export function replayDesktopRelationRecovery(base: EntityRelation[], changes: DesktopRelationRecoveryChange[]) {
  let relations = base.map(cloneRelation)
  for (const change of changes) {
    if (change.kind === 'replace') { relations = change.relations.map(cloneRelation); continue }
    const key = relationKey(change.relation)
    const index = relations.findIndex((relation) => relationKey(relation) === key)
    if (change.kind === 'delete') {
      if (index >= 0) relations.splice(index, 1)
    } else if (index >= 0) relations[index] = cloneRelation(change.relation)
    else relations.unshift(cloneRelation(change.relation))
  }
  return relations
}
