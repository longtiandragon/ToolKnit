import type { ReviewState, VocabularyEntry, VocabularySense } from '@/types'
import { cloneReviewState } from './review-state'

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function reviewFacets(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const facets: NonNullable<VocabularySense['reviewFacets']> = Object.fromEntries(['spelling', 'example', 'comparison'].flatMap((facet) => {
    const review = input[facet]
    return review && typeof review === 'object' && typeof (review as Partial<ReviewState>).due === 'string'
      ? [[facet, cloneReviewState(review as ReviewState)]]
      : []
  }))
  return Object.keys(facets).length ? facets : undefined
}

export function cloneVocabularySense(sense: VocabularySense): VocabularySense {
  const plain = JSON.parse(JSON.stringify(sense)) as Partial<VocabularySense>
  return {
    id: typeof plain.id === 'string' ? plain.id : crypto.randomUUID(),
    partOfSpeech: typeof plain.partOfSpeech === 'string' ? plain.partOfSpeech : '',
    definition: typeof plain.definition === 'string' ? plain.definition : '',
    examples: stringList(plain.examples),
    collocations: stringList(plain.collocations),
    synonyms: stringList(plain.synonyms),
    reviewEnabled: typeof plain.reviewEnabled === 'boolean' ? plain.reviewEnabled : true,
    ...(plain.review && typeof plain.review.due === 'string' ? { review: cloneReviewState(plain.review) } : {}),
    ...(reviewFacets(plain.reviewFacets) ? { reviewFacets: reviewFacets(plain.reviewFacets) } : {})
  }
}

export function cloneVocabularyEntry(entry: VocabularyEntry): VocabularyEntry {
  const plain = JSON.parse(JSON.stringify(entry)) as Partial<VocabularyEntry>
  const forms = plain.forms && typeof plain.forms === 'object' && !Array.isArray(plain.forms)
    ? Object.fromEntries(Object.entries(plain.forms).filter((item): item is [string, string] => typeof item[1] === 'string' && item[0].trim().length > 0))
    : {}
  return {
    id: typeof plain.id === 'string' ? plain.id : crypto.randomUUID(),
    lemma: typeof plain.lemma === 'string' ? plain.lemma : '',
    language: typeof plain.language === 'string' ? plain.language : '英语',
    ...(typeof plain.pronunciation === 'string' && plain.pronunciation.trim() ? { pronunciation: plain.pronunciation } : {}),
    forms,
    senses: Array.isArray(plain.senses) ? plain.senses.map((sense) => cloneVocabularySense(sense as VocabularySense)) : [],
    createdAt: typeof plain.createdAt === 'string' ? plain.createdAt : new Date().toISOString(),
    updatedAt: typeof plain.updatedAt === 'string' ? plain.updatedAt : new Date().toISOString(),
    ...(plain.summaryOnly === true ? { summaryOnly: true } : {}),
    ...(typeof plain.senseCount === 'number' ? { senseCount: Math.max(0, Math.floor(plain.senseCount)) } : {}),
    ...(typeof plain.partOfSpeechPreview === 'string' ? { partOfSpeechPreview: plain.partOfSpeechPreview } : {}),
    ...(typeof plain.definitionPreview === 'string' ? { definitionPreview: plain.definitionPreview } : {})
  }
}

export function vocabularySenseCount(entry: VocabularyEntry) {
  return entry.summaryOnly ? entry.senseCount ?? 0 : entry.senses.length
}
