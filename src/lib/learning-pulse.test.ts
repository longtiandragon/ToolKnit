import { describe, expect, it } from 'vitest'
import type { StudyDocument, VocabularyEntry } from '@/types'
import { calculateLearningPulse } from './learning-pulse'

const firstReview = { due: '2026-08-09T08:00:00.000Z', intervalDays: 1, repetitions: 1, lapses: 0, lastReviewedAt: '2026-08-08T08:00:00.000Z' }
const newReview = { due: '2026-08-10T08:00:00.000Z', intervalDays: 0, repetitions: 0, lapses: 0 }
const now = new Date('2026-08-09T12:00:00.000Z')

const documents: StudyDocument[] = [
  { id: 'question-1', title: '二分', kind: 'question', subject: '算法', tags: [], difficulty: 3, content: '', createdAt: now.toISOString(), updatedAt: now.toISOString(), reviewEnabled: true, review: firstReview, reviewFacets: { error: firstReview }, errorTypes: [] },
  { id: 'note-1', title: '普通笔记', kind: 'note', subject: '算法', tags: [], difficulty: 0, content: '', createdAt: now.toISOString(), updatedAt: now.toISOString(), reviewEnabled: false, errorTypes: [] },
]

const vocabulary: VocabularyEntry[] = [{
  id: 'word-1', lemma: 'run', language: '英语', forms: {}, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  senses: [{
    id: 'sense-1', partOfSpeech: 'verb', definition: '运行', examples: [], collocations: [], synonyms: [], reviewEnabled: true,
    review: newReview,
    reviewFacets: { spelling: firstReview, example: { ...newReview, due: 'not-a-date' } },
  }]
}]

describe('learning pulse', () => {
  it('counts question and vocabulary directions as independent cards', () => {
    expect(calculateLearningPulse(documents, vocabulary, now)).toEqual({
      dueCount: 3,
      reviewableCount: 5,
      reviewedCount: 3,
      coveragePercent: 60,
    })
  })

  it('does not treat malformed due dates as ready to review', () => {
    expect(calculateLearningPulse([], [{ ...vocabulary[0], senses: [{ ...vocabulary[0].senses[0], review: { ...newReview, due: 'broken' }, reviewFacets: undefined }] }], now)).toMatchObject({
      dueCount: 0,
      reviewableCount: 1,
      reviewedCount: 0,
    })
  })
})
