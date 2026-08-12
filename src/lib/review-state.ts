import type { FsrsCardState, ReviewState } from '@/types'

function nonNegativeInteger(value: unknown) {
  return Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : 0
}

function finiteNumber(value: unknown) {
  return Number.isFinite(value) ? Number(value) : 0
}

function normalizeFsrsState(value: unknown): FsrsCardState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const state = (value as Partial<FsrsCardState>).state
  if (!Number.isFinite(state) || Number(state) < 0 || Number(state) > 3) return undefined
  return {
    state: Math.round(Number(state)),
    stability: Math.max(0, finiteNumber((value as Partial<FsrsCardState>).stability)),
    difficulty: Math.max(0, finiteNumber((value as Partial<FsrsCardState>).difficulty)),
    elapsedDays: nonNegativeInteger((value as Partial<FsrsCardState>).elapsedDays),
    scheduledDays: nonNegativeInteger((value as Partial<FsrsCardState>).scheduledDays),
    learningSteps: nonNegativeInteger((value as Partial<FsrsCardState>).learningSteps)
  }
}

/** Repairs browser restores while retaining every FSRS field needed for the
 * next scheduling decision. It intentionally accepts old interval-only cards. */
export function cloneReviewState(review: ReviewState): ReviewState {
  const fsrs = normalizeFsrsState(review.fsrs)
  return {
    due: review.due,
    intervalDays: Math.max(0, finiteNumber(review.intervalDays)),
    repetitions: nonNegativeInteger(review.repetitions),
    lapses: nonNegativeInteger(review.lapses),
    ...(typeof review.lastReviewedAt === 'string' ? { lastReviewedAt: review.lastReviewedAt } : {}),
    ...(fsrs ? { fsrs } : {})
  }
}
