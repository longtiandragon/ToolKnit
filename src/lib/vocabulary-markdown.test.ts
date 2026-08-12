import { describe, expect, it } from 'vitest'
import type { VocabularyEntry } from '@/types'
import { vocabularyToMarkdown } from './vocabulary-markdown'

const entry: VocabularyEntry = {
  id: 'word-1', lemma: ' run ', language: '英语', pronunciation: '/rʌn/', forms: { base: 'run', past: 'ran', presentParticiple: 'running' },
  senses: [
    { id: 'sense-1', partOfSpeech: 'verb', definition: '跑；运行', examples: ['The program runs.'], collocations: ['run a program'], synonyms: ['operate'], reviewEnabled: true, review: { due: '2026-08-10', intervalDays: 1, repetitions: 1, lapses: 0 } },
    { id: 'sense-2', partOfSpeech: '', definition: '', examples: [], collocations: [], synonyms: [], reviewEnabled: false },
  ],
  createdAt: '2026-08-08', updatedAt: '2026-08-09'
}

describe('vocabularyToMarkdown', () => {
  it('exports forms and every sense while keeping review scheduling private', () => {
    const markdown = vocabularyToMarkdown(entry)
    expect(markdown).toContain('# run')
    expect(markdown).toContain('- 读音：/rʌn/')
    expect(markdown).toContain('- past：ran')
    expect(markdown).toContain('### 1. verb')
    expect(markdown).toContain('**例句**\n- The program runs.')
    expect(markdown).toContain('**常用搭配**\n- run a program')
    expect(markdown).toContain('### 2. 未分类')
    expect(markdown).not.toContain('2026-08-10')
    expect(markdown.endsWith('\n')).toBe(true)
  })
})
