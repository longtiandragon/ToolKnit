import { describe, expect, it } from 'vitest'
import { gradeFsrsReview } from './fsrs-review'
import { cloneReviewState } from './review-state'

describe('FSRS review persistence', () => {
  it('records complete scheduler state after grading an interval-only legacy card', async () => {
    const gradedAt = new Date('2026-08-09T09:00:00.000Z')
    const review = await gradeFsrsReview({
      due: '2026-08-09T08:00:00.000Z', intervalDays: 0, repetitions: 0, lapses: 0
    }, '2026-08-08T08:00:00.000Z', 'Good', gradedAt)

    expect(review.repetitions).toBeGreaterThan(0)
    expect(review.lastReviewedAt).toBe(gradedAt.toISOString())
    expect(review.fsrs).toMatchObject({
      state: expect.any(Number), stability: expect.any(Number), difficulty: expect.any(Number),
      elapsedDays: expect.any(Number), scheduledDays: expect.any(Number), learningSteps: expect.any(Number)
    })
  })

  it('keeps a valid saved FSRS state but drops malformed scheduler metadata', () => {
    const valid = cloneReviewState({
      due: '2026-08-10T00:00:00.000Z', intervalDays: 3, repetitions: 2, lapses: 0,
      fsrs: { state: 2, stability: 3.4, difficulty: 6.2, elapsedDays: 3, scheduledDays: 4, learningSteps: 0 }
    })
    expect(valid.fsrs).toEqual({ state: 2, stability: 3.4, difficulty: 6.2, elapsedDays: 3, scheduledDays: 4, learningSteps: 0 })

    const malformed = cloneReviewState({
      due: '2026-08-10T00:00:00.000Z', intervalDays: 3, repetitions: 2, lapses: 0,
      fsrs: { state: 8, stability: 3, difficulty: 4, elapsedDays: 1, scheduledDays: 1, learningSteps: 0 }
    })
    expect(malformed.fsrs).toBeUndefined()
  })
})
