import type { ReviewState, VocabularyReviewFacet, VocabularySense } from '@/types'

export interface VocabularyReviewCard {
  facet: VocabularyReviewFacet
  review: ReviewState
}

export const vocabularyReviewFacetOrder: readonly VocabularyReviewFacet[] = ['meaning', 'spelling', 'example']

export const vocabularyReviewFacetLabels: Record<VocabularyReviewFacet, string> = {
  meaning: '词义',
  spelling: '拼写',
  example: '例句填空'
}

/** Old Vault entries only have `review`; that is deliberately interpreted as
 * a meaning card, so introducing richer directions never reschedules it. */
export function vocabularyReviewCards(sense: VocabularySense): VocabularyReviewCard[] {
  return vocabularyReviewFacetOrder.flatMap((facet) => {
    const review = facet === 'meaning' ? sense.review : sense.reviewFacets?.[facet]
    return review ? [{ facet, review }] : []
  })
}

export function vocabularyReviewForFacet(sense: VocabularySense, facet: VocabularyReviewFacet) {
  return facet === 'meaning' ? sense.review : sense.reviewFacets?.[facet]
}

export function withVocabularyReviewFacet(sense: VocabularySense, facet: VocabularyReviewFacet, review?: ReviewState): VocabularySense {
  if (facet === 'meaning') {
    const next = { ...sense, review }
    return { ...next, reviewEnabled: vocabularyReviewCards(next).length > 0 }
  }
  const facets = { ...sense.reviewFacets }
  if (review) facets[facet] = review
  else delete facets[facet]
  const next = { ...sense, reviewFacets: Object.keys(facets).length ? facets : undefined }
  return { ...next, reviewEnabled: vocabularyReviewCards(next).length > 0 }
}

export function createVocabularyReviewState(at = new Date().toISOString()): ReviewState {
  return { due: at, intervalDays: 0, repetitions: 0, lapses: 0 }
}
