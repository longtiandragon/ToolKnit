import type { ReviewRating } from '@/types'
import type { DesktopReviewAnalytics } from './native'

export function localReviewDateKey(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Applies the one known local event without re-running the 365-day aggregate
 * after every keypress. `undefined` means the page crossed local midnight and
 * must refresh from SQLite instead of guessing streak boundaries. */
export function applyNativeReviewGradeToAnalytics(
  analytics: DesktopReviewAnalytics,
  rating: ReviewRating,
  todayKey = localReviewDateKey(),
) {
  const today = analytics.daily14Days.at(-1)
  if (!today || today.date !== todayKey) return undefined
  const firstToday = today.count === 0
  const next: DesktopReviewAnalytics = {
    ...analytics,
    totalReviews: analytics.totalReviews + 1,
    reviewedToday: analytics.reviewedToday + 1,
    reviewed7Days: analytics.reviewed7Days + 1,
    reviewed30Days: analytics.reviewed30Days + 1,
    studyDays30: analytics.studyDays30 + Number(firstToday),
    currentStreakDays: firstToday ? Math.max(1, analytics.currentStreakDays + 1) : analytics.currentStreakDays,
    daily14Days: analytics.daily14Days.map((day, index) => index === analytics.daily14Days.length - 1 ? { ...day, count: day.count + 1 } : day),
  }
  if (rating === 'Again') next.again30Days += 1
  else if (rating === 'Hard') next.hard30Days += 1
  else if (rating === 'Good') next.good30Days += 1
  else next.easy30Days += 1
  next.longestStreak365Days = Math.max(next.longestStreak365Days, next.currentStreakDays)
  return next
}
