import { describe, expect, it } from 'vitest'
import { buildVocabularyCloze, countReviewKinds, filterReviewItems, isVocabularyAnswerVisible, normalizeVocabularyReviewAnswer, reviewKindFromQuery, vocabularyReviewAnswerMatches, vocabularyReviewHeading } from './review-session'

const items = [
  { id: 'q1', type: 'question' as const, facet: 'answer' },
  { id: 'q2', type: 'question' as const, facet: 'error' },
  { id: 'w1', type: 'word' as const },
  { id: 'w2', type: 'word' as const },
]

describe('review session kind', () => {
  it('normalizes deep-link query values', () => {
    expect(reviewKindFromQuery('question')).toBe('question')
    expect(reviewKindFromQuery('error')).toBe('error')
    expect(reviewKindFromQuery(['word'])).toBe('word')
    expect(reviewKindFromQuery('unknown')).toBe('all')
  })

  it('filters without mutating the complete due queue', () => {
    expect(filterReviewItems(items, 'word').map((item) => item.id)).toEqual(['w1', 'w2'])
    expect(filterReviewItems(items, 'error').map((item) => item.id)).toEqual(['q2'])
    expect(filterReviewItems(items, 'all')).toEqual(items)
    expect(filterReviewItems(items, 'all')).not.toBe(items)
  })

  it('counts both material kinds in one pass', () => {
    expect(countReviewKinds(items)).toEqual({ all: 4, question: 2, error: 1, word: 2 })
  })
})

describe('word review answer boundary', () => {
  it('keeps the lemma visible on a meaning prompt', () => {
    expect(isVocabularyAnswerVisible('meaning', false)).toBe(true)
    expect(vocabularyReviewHeading('run', 'meaning', false)).toBe('run')
  })

  it('masks spelling and cloze answers until reveal', () => {
    expect(vocabularyReviewHeading('run', 'spelling', false)).toBe('根据释义拼写')
    expect(vocabularyReviewHeading('run', 'example', false)).toBe('补全例句')
    expect(isVocabularyAnswerVisible('spelling', false)).toBe(false)
    expect(vocabularyReviewHeading('run', 'spelling', true)).toBe('run')
  })

  it('normalizes harmless case, width, spacing and punctuation differences', () => {
    expect(normalizeVocabularyReviewAnswer('  Ｓｅｒｅｎｄｉｐｉｔｙ。 ')).toBe('serendipity')
    expect(vocabularyReviewAnswerMatches('  New   York! ', 'new york')).toBe(true)
    expect(vocabularyReviewAnswerMatches('runner', 'running')).toBe(false)
    expect(vocabularyReviewAnswerMatches('   ', 'run')).toBe(false)
  })

  it('checks cloze answers against the exact surface form removed from an example', () => {
    expect(buildVocabularyCloze('run', 'She is running quickly.', 'fallback')).toEqual({
      prompt: 'She is ＿＿＿＿ quickly.',
      expected: 'running',
      ready: true,
    })
    expect(buildVocabularyCloze('学习', '我每天学习英语。', 'fallback')).toEqual({
      prompt: '我每天＿＿＿＿英语。',
      expected: '学习',
      ready: true,
    })
  })

  it('never returns an unmatched example that could expose the answer', () => {
    expect(buildVocabularyCloze('went', 'She goes home.', '回家')).toEqual({
      prompt: '这条例句暂时无法安全挖空，请补充一条包含该单词的例句。',
      expected: 'went',
      ready: false,
    })
  })
})
