import type { ReviewState, StudyDocument, VocabularyEntry } from '@/types'
import { vocabularyReviewCards } from './vocabulary-review'
import { questionReviewCards } from './question-review'

export interface LearningPulse {
  dueCount: number
  reviewableCount: number
  reviewedCount: number
  coveragePercent: number
}

function hasValidReviewTime(value: string | undefined) {
  return Boolean(value && Number.isFinite(new Date(value).getTime()))
}

function isDue(review: ReviewState, now: number) {
  const dueAt = new Date(review.due).getTime()
  return Number.isFinite(dueAt) && dueAt <= now
}

/**
 * The dashboard and Review space deliberately count the same atomic cards.
 * A vocabulary sense can produce meaning, spelling and cloze cards, while a
 * question can produce answer and error-reflection cards. Keeping that
 * distinction here prevents the
 * dashboard from presenting a falsely empty review queue.
 */
export function calculateLearningPulse(documents: StudyDocument[], vocabulary: VocabularyEntry[], at = new Date()): LearningPulse {
  const documentCards = documents.flatMap((document) => questionReviewCards(document).map((card) => card.review))
  const vocabularyCards = vocabulary.flatMap((entry) => entry.senses.flatMap((sense) => vocabularyReviewCards(sense).map((card) => card.review)))
  const cards = [...documentCards, ...vocabularyCards]
  const now = at.getTime()
  const dueCount = cards.filter((review) => isDue(review, now)).length
  const reviewedCount = cards.filter((review) => hasValidReviewTime(review.lastReviewedAt)).length
  return {
    dueCount,
    reviewableCount: cards.length,
    reviewedCount,
    coveragePercent: cards.length ? Math.min(100, Math.round((reviewedCount / cards.length) * 100)) : 0,
  }
}
