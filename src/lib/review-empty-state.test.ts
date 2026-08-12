import { describe, expect, it } from 'vitest'
import { formatNextReviewDue, resolveReviewEmptyState } from './review-empty-state'

const base = { sessionReviewed: 0, filtered: false, totalDue: 0, filteredDue: 0, materialCount: 0, scheduledCardCount: 0 }

describe('review empty states', () => {
  it('distinguishes completion, filtering, missing material, missing cards and a future schedule', () => {
    expect(resolveReviewEmptyState({ ...base, sessionReviewed: 2 })).toBe('complete')
    expect(resolveReviewEmptyState({ ...base, filtered: true, totalDue: 3, materialCount: 2, scheduledCardCount: 3 })).toBe('filtered')
    expect(resolveReviewEmptyState(base)).toBe('no-material')
    expect(resolveReviewEmptyState({ ...base, materialCount: 2 })).toBe('no-cards')
    expect(resolveReviewEmptyState({ ...base, materialCount: 2, scheduledCardCount: 4 })).toBe('waiting')
  })

  it('formats the next scheduled review without exposing raw timestamps', () => {
    const now = Date.parse('2026-08-11T00:00:00.000Z')
    expect(formatNextReviewDue('', now)).toBe('尚未安排')
    expect(formatNextReviewDue('2026-08-10T23:00:00.000Z', now)).toBe('已经到期')
    expect(formatNextReviewDue('2026-08-11T00:21:00.000Z', now)).toBe('21 分钟后')
    expect(formatNextReviewDue('2026-08-11T03:10:00.000Z', now)).toBe('4 小时后')
  })
})
