import type { CanvasAnnotation } from './annotation-canvas'

export interface AnnotationHistory {
  past: CanvasAnnotation[][]
  present: CanvasAnnotation[]
  future: CanvasAnnotation[][]
}

const defaultLimit = 60

function cloneSnapshot(annotations: CanvasAnnotation[]) {
  return annotations.map((annotation) => ({ ...annotation }))
}

function snapshotsEqual(left: CanvasAnnotation[], right: CanvasAnnotation[]) {
  if (left.length !== right.length) return false
  return left.every((annotation, index) => {
    const candidate = right[index]
    return annotation.id === candidate?.id
      && annotation.kind === candidate.kind
      && annotation.x === candidate.x
      && annotation.y === candidate.y
      && annotation.width === candidate.width
      && annotation.height === candidate.height
      && annotation.text === candidate.text
      && annotation.color === candidate.color
  })
}

export function createAnnotationHistory(initial: CanvasAnnotation[] = []): AnnotationHistory {
  return { past: [], present: cloneSnapshot(initial), future: [] }
}

/**
 * Keep only small, immutable annotation snapshots. Source images remain URL-backed
 * and are intentionally never included in the history, so undo stays responsive.
 */
export function commitAnnotationHistory(history: AnnotationHistory, next: CanvasAnnotation[], limit = defaultLimit): AnnotationHistory {
  const present = cloneSnapshot(next)
  if (snapshotsEqual(history.present, present)) return history
  return {
    past: [...history.past, cloneSnapshot(history.present)].slice(-Math.max(1, limit)),
    present,
    future: [],
  }
}

export function undoAnnotationHistory(history: AnnotationHistory): AnnotationHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: cloneSnapshot(previous),
    future: [cloneSnapshot(history.present), ...history.future],
  }
}

export function redoAnnotationHistory(history: AnnotationHistory): AnnotationHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    past: [...history.past, cloneSnapshot(history.present)],
    present: cloneSnapshot(next),
    future: history.future.slice(1),
  }
}

export function canUndoAnnotationHistory(history: AnnotationHistory) {
  return history.past.length > 0
}

export function canRedoAnnotationHistory(history: AnnotationHistory) {
  return history.future.length > 0
}
