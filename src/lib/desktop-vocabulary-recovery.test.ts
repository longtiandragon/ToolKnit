import { describe, expect, it } from 'vitest'
import { appendVocabularyRecoveryChange, DESKTOP_VOCABULARY_RECOVERY_MAX_CHARS, parseDesktopVocabularyRecovery, replayDesktopVocabularyRecovery, serializeDesktopVocabularyRecovery, serializeDesktopVocabularyRecoveryBounded } from './desktop-vocabulary-recovery'
import type { VocabularyEntry } from '@/types'

function entry(id: string, lemma = id): VocabularyEntry {
  return {
    id,
    lemma,
    language: '英语',
    forms: {},
    senses: [{ id: `${id}-sense`, partOfSpeech: 'noun', definition: lemma, examples: [], collocations: [], synonyms: [], reviewEnabled: false }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('desktop vocabulary recovery journal', () => {
  it('continues to read the complete v1 emergency snapshot', () => {
    const recovery = parseDesktopVocabularyRecovery(JSON.stringify({ vocabulary: [entry('legacy')] }))
    expect(recovery.exists).toBe(true)
    expect(recovery.snapshot?.map((item) => item.id)).toEqual(['legacy'])
    expect(recovery.changes).toEqual([])
  })

  it('coalesces a word write journal and replays the latest state', () => {
    let changes = appendVocabularyRecoveryChange([], { kind: 'save', entry: entry('run', 'run') })
    changes = appendVocabularyRecoveryChange(changes, { kind: 'save', entry: entry('run', 'running') })
    changes = appendVocabularyRecoveryChange(changes, { kind: 'delete', id: 'old' })
    expect(changes).toHaveLength(2)
    expect(replayDesktopVocabularyRecovery([entry('run', 'old'), entry('old')], changes).map((item) => `${item.id}:${item.lemma}`)).toEqual(['run:running'])
  })

  it('serializes a compact v2 journal without unrelated vocabulary entries', () => {
    const raw = serializeDesktopVocabularyRecovery([{ kind: 'save', entry: entry('active', 'active') }], '2026-01-02T00:00:00.000Z')
    const parsed = parseDesktopVocabularyRecovery(raw)
    expect(parsed.snapshot).toBeUndefined()
    expect(parsed.changes).toHaveLength(1)
    expect(parsed.changes[0]).toMatchObject({ kind: 'save', entry: { id: 'active' } })
  })

  it('does not stringify a vocabulary entry beyond the recovery budget', () => {
    const huge = entry('huge')
    huge.senses[0].definition = '词义 '.repeat(DESKTOP_VOCABULARY_RECOVERY_MAX_CHARS)
    expect(serializeDesktopVocabularyRecoveryBounded([{ kind: 'save', entry: huge }], '2026-01-02T00:00:00.000Z')).toBeUndefined()
  })
})
