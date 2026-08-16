import { describe, expect, it } from 'vitest'
import type { DesktopReviewCardSummary, DesktopReviewQueueSummary } from './native'
import { mergeNativeReviewCards, updateNativeReviewDueSummary } from './native-review-session'

const review = { due: '2026-08-10T00:00:00Z', intervalDays: 0, repetitions: 0, lapses: 0 }
const card = (id: string, dueEpoch: number, kind: 'question' | 'word', facet: DesktopReviewCardSummary['facet']): DesktopReviewCardSummary => ({
  id,
  entityId: `${kind}-1`,
  entityKind: kind,
  title: id,
  facet,
  due: new Date(dueEpoch * 1_000).toISOString(),
  dueEpoch,
  review,
  senseId: kind === 'word' ? 'sense-1' : undefined,
  context: '',
  detail: '',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-09T00:00:00Z',
})
const summary: DesktopReviewQueueSummary = {
  scheduledCount: 4,
  reviewedCount: 0,
  dueCount: 4,
  dueQuestionCount: 2,
  dueErrorCount: 1,
  dueWordCount: 2,
  questionMaterialCount: 1,
  vocabularyMaterialCount: 1,
}

describe('native review session projection', () => {
  it('deduplicates keyset pages and preserves database ordering', () => {
    const first = card('b', 20, 'question', 'answer')
    const replacement = { ...first, title: 'newer projection' }
    const merged = mergeNativeReviewCards(
      [first, card('c', 30, 'word', 'meaning')],
      [card('a', 20, 'question', 'error'), replacement],
    )
    expect(merged.map(({ id }) => id)).toEqual(['a', 'b', 'c'])
    expect(merged.find(({ id }) => id === 'b')?.title).toBe('newer projection')
  })

  it('updates only the matching due counters and never underflows', () => {
    const error = card('question:error', 20, 'question', 'error')
    const afterGrade = updateNativeReviewDueSummary(summary, error, -1)
    expect(afterGrade).toMatchObject({ dueCount: 3, dueQuestionCount: 1, dueErrorCount: 0, dueWordCount: 2, scheduledCount: 4 })
    expect(updateNativeReviewDueSummary(afterGrade, error, 1)).toEqual(summary)
    expect(updateNativeReviewDueSummary({ ...summary, dueCount: 0, dueQuestionCount: 0, dueErrorCount: 0 }, error, -1))
      .toMatchObject({ dueCount: 0, dueQuestionCount: 0, dueErrorCount: 0 })
  })
})
