import { describe, expect, it } from 'vitest'
import type { VocabularyEntry } from '@/types'
import { matchesVocabularySearch, vocabularySearchText } from './vocabulary-search'

const run: VocabularyEntry = {
  id: 'run',
  lemma: 'run',
  language: '英语',
  pronunciation: '/rʌn/',
  forms: { past: 'ran', presentParticiple: 'running' },
  senses: [{
    id: 'run-verb',
    partOfSpeech: 'verb',
    definition: '运行；经营',
    examples: ['The program runs locally.'],
    collocations: ['run a program'],
    synonyms: ['operate'],
    reviewEnabled: false,
  }],
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
}

describe('vocabulary search text', () => {
  it('covers forms, senses, examples, collocations and near-synonyms', () => {
    expect(vocabularySearchText(run)).toContain('running')
    expect(matchesVocabularySearch(run, 'ran')).toBe(true)
    expect(matchesVocabularySearch(run, 'program runs')).toBe(true)
    expect(matchesVocabularySearch(run, 'run a program')).toBe(true)
    expect(matchesVocabularySearch(run, 'operate')).toBe(true)
    expect(matchesVocabularySearch(run, 'unrelated')).toBe(false)
  })
})
