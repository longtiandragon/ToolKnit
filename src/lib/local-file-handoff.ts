export type LocalFileHandoffTarget = 'ocr' | 'markdown'

export interface LocalFileHandoff {
  target: LocalFileHandoffTarget
  paths: string[]
  sourceLabel?: string
  createdAt: number
}

const HANDOFF_TTL_MS = 2 * 60 * 1000
const HANDOFF_PATH_LIMIT = 8
const pending = new Map<LocalFileHandoffTarget, LocalFileHandoff>()

/**
 * Keep sensitive desktop paths out of route queries and persistent stores.
 * A destination consumes this short-lived payload exactly once.
 */
export function stageLocalFileHandoff(
  target: LocalFileHandoffTarget,
  paths: string[],
  sourceLabel?: string,
  now = Date.now(),
) {
  const uniquePaths = [...new Set(paths.map(path => path.trim()).filter(Boolean))].slice(0, HANDOFF_PATH_LIMIT)
  if (!uniquePaths.length) {
    pending.delete(target)
    return undefined
  }
  const handoff: LocalFileHandoff = { target, paths: uniquePaths, sourceLabel: sourceLabel?.trim() || undefined, createdAt: now }
  pending.set(target, handoff)
  return { ...handoff, paths: [...handoff.paths] }
}

export function consumeLocalFileHandoff(target: LocalFileHandoffTarget, now = Date.now()) {
  const handoff = pending.get(target)
  if (!handoff) return undefined
  pending.delete(target)
  if (now - handoff.createdAt > HANDOFF_TTL_MS || now < handoff.createdAt) return undefined
  return { ...handoff, paths: [...handoff.paths] }
}

export function clearLocalFileHandoff(target: LocalFileHandoffTarget) {
  pending.delete(target)
}
