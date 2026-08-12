import type { ReviewRating, ReviewState } from '@/types'
import { cloneReviewState } from './review-state'

function dateFrom(value: string, fallback: Date) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

/**
 * Schedule one card without pulling the FSRS implementation into the startup
 * bundle. The opaque scheduler state is persisted alongside the friendly
 * summary fields so every later grade continues the same learning history.
 */
export async function gradeFsrsReview(review: ReviewState, createdAt: string, rating: ReviewRating, gradedAt = new Date()): Promise<ReviewState> {
  const { createEmptyCard, fsrs, Rating } = await import('ts-fsrs')
  const previous = cloneReviewState(review)
  const card = createEmptyCard(dateFrom(createdAt, gradedAt))
  card.due = dateFrom(previous.due, gradedAt)
  card.reps = previous.repetitions
  card.lapses = previous.lapses
  card.last_review = previous.lastReviewedAt ? dateFrom(previous.lastReviewedAt, gradedAt) : undefined
  if (previous.fsrs) {
    card.state = previous.fsrs.state
    card.stability = previous.fsrs.stability
    card.difficulty = previous.fsrs.difficulty
    card.elapsed_days = previous.fsrs.elapsedDays
    card.scheduled_days = previous.fsrs.scheduledDays
    card.learning_steps = previous.fsrs.learningSteps
  }
  const gradeMap = { Again: Rating.Again, Hard: Rating.Hard, Good: Rating.Good, Easy: Rating.Easy } as const
  const next = fsrs().next(card, gradedAt, gradeMap[rating]).card
  return cloneReviewState({
    due: next.due.toISOString(),
    intervalDays: next.scheduled_days,
    repetitions: next.reps,
    lapses: next.lapses,
    lastReviewedAt: gradedAt.toISOString(),
    fsrs: {
      state: next.state,
      stability: next.stability,
      difficulty: next.difficulty,
      elapsedDays: next.elapsed_days,
      scheduledDays: next.scheduled_days,
      learningSteps: next.learning_steps
    }
  })
}
