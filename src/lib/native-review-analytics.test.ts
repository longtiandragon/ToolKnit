import { describe, expect, it } from 'vitest'
import type { DesktopReviewAnalytics } from './native'
import { applyNativeReviewGradeToAnalytics, localReviewDateKey } from './native-review-analytics'

const analytics = (): DesktopReviewAnalytics => ({
  totalReviews: 10,
  reviewedToday: 0,
  reviewed7Days: 4,
  reviewed30Days: 8,
  studyDays30: 5,
  currentStreakDays: 2,
  longestStreak365Days: 4,
  again30Days: 1,
  hard30Days: 2,
  good30Days: 3,
  easy30Days: 2,
  daily14Days: [
    { date: '2026-08-15', count: 2 },
    { date: '2026-08-16', count: 0 },
  ],
})

describe('native review analytics projection', () => {
  it('increments the current local day and the selected rating once', () => {
    const first = applyNativeReviewGradeToAnalytics(analytics(), 'Good', '2026-08-16')!
    expect(first).toMatchObject({
      totalReviews: 11,
      reviewedToday: 1,
      reviewed7Days: 5,
      reviewed30Days: 9,
      studyDays30: 6,
      currentStreakDays: 3,
      longestStreak365Days: 4,
      good30Days: 4,
    })
    expect(first.daily14Days.at(-1)?.count).toBe(1)

    const second = applyNativeReviewGradeToAnalytics(first, 'Easy', '2026-08-16')!
    expect(second.studyDays30).toBe(6)
    expect(second.currentStreakDays).toBe(3)
    expect(second.easy30Days).toBe(3)
  })

  it('refuses to project across a local-day rollover', () => {
    expect(applyNativeReviewGradeToAnalytics(analytics(), 'Again', '2026-08-17')).toBeUndefined()
    expect(localReviewDateKey(new Date(2026, 7, 6))).toBe('2026-08-06')
  })
})
