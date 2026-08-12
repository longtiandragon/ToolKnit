export type ReviewEmptyState = 'complete' | 'filtered' | 'no-material' | 'no-cards' | 'waiting'

export function resolveReviewEmptyState(input: {
  sessionReviewed: number
  filtered: boolean
  totalDue: number
  filteredDue: number
  materialCount: number
  scheduledCardCount: number
}): ReviewEmptyState {
  if (input.sessionReviewed > 0) return 'complete'
  if (input.filtered && input.totalDue > 0 && input.filteredDue === 0) return 'filtered'
  if (input.materialCount === 0) return 'no-material'
  if (input.scheduledCardCount === 0) return 'no-cards'
  return 'waiting'
}

export function formatNextReviewDue(value: string, now = Date.now()) {
  if (!value) return '尚未安排'
  const due = new Date(value)
  const delta = due.getTime() - now
  if (!Number.isFinite(delta)) return '尚未安排'
  if (delta <= 0) return '已经到期'
  if (delta < 60 * 60 * 1000) return `${Math.max(1, Math.ceil(delta / 60000))} 分钟后`
  if (delta < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.ceil(delta / 3600000))} 小时后`
  return due.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
}
