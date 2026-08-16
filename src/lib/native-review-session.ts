import type { DesktopReviewCardSummary, DesktopReviewQueueSummary } from './native'

export function mergeNativeReviewCards(current: DesktopReviewCardSummary[], incoming: DesktopReviewCardSummary[]) {
  const byId = new Map(current.map((card) => [card.id, card]))
  for (const card of incoming) byId.set(card.id, card)
  return [...byId.values()].sort((left, right) => left.dueEpoch - right.dueEpoch || left.id.localeCompare(right.id))
}

function dueDelta(card: DesktopReviewCardSummary, direction: -1 | 1) {
  return {
    dueCount: direction,
    dueQuestionCount: card.entityKind === 'question' ? direction : 0,
    dueErrorCount: card.entityKind === 'question' && card.facet === 'error' ? direction : 0,
    dueWordCount: card.entityKind === 'word' ? direction : 0,
  }
}

/** Session counters change locally after an atomic grade so the header never
 * waits for a second database round-trip. The next page refresh remains the
 * authority for cross-window changes. */
export function updateNativeReviewDueSummary(
  summary: DesktopReviewQueueSummary,
  card: DesktopReviewCardSummary,
  direction: -1 | 1,
): DesktopReviewQueueSummary {
  const delta = dueDelta(card, direction)
  return {
    ...summary,
    dueCount: Math.max(0, summary.dueCount + delta.dueCount),
    dueQuestionCount: Math.max(0, summary.dueQuestionCount + delta.dueQuestionCount),
    dueErrorCount: Math.max(0, summary.dueErrorCount + delta.dueErrorCount),
    dueWordCount: Math.max(0, summary.dueWordCount + delta.dueWordCount),
  }
}
