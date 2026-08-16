import { describe, expect, it } from 'vitest'
import type { VocabularySense } from '@/types'
import { cloneVocabularySense } from './vocabulary'
import { vocabularyReviewCards, vocabularyReviewForFacet, withVocabularyReviewFacet } from './vocabulary-review'

const initial: VocabularySense = {
  id: 'sense-1', partOfSpeech: 'verb', definition: '运行', examples: ['The program runs.'], collocations: ['run a program'], synonyms: [], reviewEnabled: true,
  review: { due: '2026-08-09T00:00:00.000Z', intervalDays: 1, repetitions: 1, lapses: 0 }
}

describe('vocabulary review facets', () => {
  it('treats legacy schedules as a meaning card without rewriting them', () => {
    expect(vocabularyReviewCards(initial)).toEqual([{ facet: 'meaning', review: initial.review }])
  })

  it('keeps spelling, cloze and comparison scheduling independent from meaning', () => {
    const spelling = { due: '2026-08-10T00:00:00.000Z', intervalDays: 2, repetitions: 2, lapses: 0 }
    const example = { due: '2026-08-11T00:00:00.000Z', intervalDays: 3, repetitions: 3, lapses: 0 }
    const comparison = { due: '2026-08-12T00:00:00.000Z', intervalDays: 4, repetitions: 1, lapses: 0 }
    const next = withVocabularyReviewFacet(withVocabularyReviewFacet(withVocabularyReviewFacet(initial, 'spelling', spelling), 'example', example), 'comparison', comparison)
    expect(vocabularyReviewCards(next).map((card) => card.facet)).toEqual(['meaning', 'spelling', 'example', 'comparison'])
    expect(vocabularyReviewForFacet(next, 'meaning')).toEqual(initial.review)
    expect(vocabularyReviewForFacet(next, 'spelling')).toEqual(spelling)
    expect(vocabularyReviewForFacet(next, 'comparison')).toEqual(comparison)
    expect(withVocabularyReviewFacet(next, 'spelling').reviewEnabled).toBe(true)
    expect(cloneVocabularySense(next).reviewFacets?.comparison).toEqual(comparison)
  })
})
