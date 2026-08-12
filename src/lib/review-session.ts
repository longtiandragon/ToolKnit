import type { VocabularyReviewFacet } from '@/types'

export type ReviewKind = 'all' | 'question' | 'error' | 'word'

const reviewKinds = new Set<ReviewKind>(['all', 'question', 'error', 'word'])

export function reviewKindFromQuery(value: unknown): ReviewKind {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && reviewKinds.has(candidate as ReviewKind)
    ? candidate as ReviewKind
    : 'all'
}

export function filterReviewItems<T extends { type: 'question' | 'word'; facet?: unknown }>(items: readonly T[], kind: ReviewKind) {
  if (kind === 'all') return [...items]
  if (kind === 'error') return items.filter((item) => item.type === 'question' && item.facet === 'error')
  return items.filter((item) => item.type === kind)
}

export function countReviewKinds(items: readonly { type: 'question' | 'word'; facet?: unknown }[]) {
  let question = 0
  let error = 0
  let word = 0
  for (const item of items) {
    if (item.type === 'word') word += 1
    else {
      question += 1
      if (item.facet === 'error') error += 1
    }
  }
  return { all: question + word, question, error, word }
}

/** Meaning cards intentionally show the lemma as the prompt. Spelling and
 * cloze cards must not leak it through the header, menu or accessible name. */
export function isVocabularyAnswerVisible(facet: VocabularyReviewFacet, revealed: boolean) {
  return facet === 'meaning' || revealed
}

export function vocabularyReviewHeading(lemma: string, facet: VocabularyReviewFacet, revealed: boolean) {
  if (isVocabularyAnswerVisible(facet, revealed)) return lemma.trim() || '未命名单词'
  return facet === 'spelling' ? '根据释义拼写' : '补全例句'
}

export function normalizeVocabularyReviewAnswer(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s"“”'.,!?;:，。！？；：]+|[\s"“”'.,!?;:，。！？；：]+$/g, '')
}

export function vocabularyReviewAnswerMatches(input: string, expected: string) {
  const normalizedInput = normalizeVocabularyReviewAnswer(input)
  return Boolean(normalizedInput) && normalizedInput === normalizeVocabularyReviewAnswer(expected)
}

export interface VocabularyCloze {
  prompt: string
  expected: string
  ready: boolean
}

/** Produces both sides from the same match so an inflected surface form such
 * as "running" is checked against the exact word removed from the example. */
export function buildVocabularyCloze(lemma: string, example: string, fallback: string): VocabularyCloze {
  const normalizedLemma = lemma.trim()
  const normalizedExample = example.trim()
  if (!normalizedLemma || !normalizedExample) {
    return { prompt: fallback || '先为这个词义补一条例句。', expected: normalizedLemma, ready: false }
  }
  const escaped = normalizedLemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const latinWord = /^[a-z][a-z'-]*$/i.test(normalizedLemma)
  const matcher = latinWord ? new RegExp(`\\b${escaped}[a-z'-]*\\b`, 'gi') : new RegExp(escaped, 'gi')
  const match = matcher.exec(normalizedExample)
  if (!match) {
    return {
      prompt: '这条例句暂时无法安全挖空，请补充一条包含该单词的例句。',
      expected: normalizedLemma,
      ready: false,
    }
  }
  matcher.lastIndex = 0
  return { prompt: normalizedExample.replace(matcher, '＿＿＿＿'), expected: match[0], ready: true }
}
