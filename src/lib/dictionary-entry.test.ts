import { describe, expect, it } from 'vitest'
import { blankVocabularyRows, dictionaryFormsFromExchange, dictionaryRecordToRows, type DictionaryRecord } from './dictionary-entry'
import { prepareVocabularyImport } from './vocabulary-import'

const ids = () => { let index = 0; return () => `00000000-0000-7000-8000-${String(index++).padStart(12, '0')}` }

const run: DictionaryRecord = {
  word: 'run',
  phonetic: 'rʌn',
  translation: 'n. 奔跑；一段时期\nvi. 跑；运行',
  definition: 'to move fast',
  exchange: 'd:run/p:ran/3:runs/i:running/s:runs',
  query: 'running',
}

describe('dictionary completion', () => {
  it('turns one record into a row per sense, which is what the importer eats', () => {
    const rows = dictionaryRecordToRows(run)
    // The editor offers a fixed vocabulary; `n.` would land there as blank.
    expect(rows.map((row) => row.partOfSpeech)).toEqual(['noun', 'verb'])
    expect(rows.map((row) => row.definition)).toEqual(['奔跑；一段时期', '跑；运行'])
    expect(rows.every((row) => row.lemma === 'run' && row.language === '英语')).toBe(true)
    // The editor shows a bracketed phonetic; the dictionary stores a bare one.
    expect(rows[0].pronunciation).toBe('[rʌn]')
  })

  it('maps every inflection code the dictionary uses', () => {
    expect(dictionaryFormsFromExchange('d:run/p:ran/3:runs/i:running/s:runs')).toEqual({
      participle: 'run', past: 'ran', thirdPerson: 'runs', presentParticiple: 'running', plural: 'runs',
    })
    expect(dictionaryFormsFromExchange('0:good/r:better/t:best')).toEqual({ base: 'good', comparative: 'better', superlative: 'best' })
    // `1` names a relationship to another entry, not a form of this word.
    expect(dictionaryFormsFromExchange('1:lemma_variant')).toEqual({})
    expect(dictionaryFormsFromExchange('')).toEqual({})
    expect(dictionaryFormsFromExchange('garbage')).toEqual({})
  })

  it('falls back to the English definition and never drops a known word', () => {
    expect(dictionaryRecordToRows({ ...run, translation: '' })[0].definition).toBe('to move fast')
    const glossless = dictionaryRecordToRows({ ...run, translation: '', definition: '' })
    expect(glossless).toHaveLength(1)
    expect(glossless[0]).toMatchObject({ lemma: 'run', definition: '' })
    expect(dictionaryRecordToRows({ ...run, word: '   ' })).toEqual([])
  })

  it('feeds the existing import pipeline, cards and all', () => {
    const prepared = prepareVocabularyImport(dictionaryRecordToRows(run), [], 'merge', ['meaning'], ids(), '2026-08-19T00:00:00.000Z')
    expect(prepared).toMatchObject({ newCount: 1, addedSenseCount: 2, reviewCardCount: 2 })
    const [entry] = prepared.entries
    expect(entry.pronunciation).toBe('[rʌn]')
    expect(entry.forms).toMatchObject({ past: 'ran', presentParticiple: 'running' })
    // Every sense gets its meaning card, which is the agreed behaviour.
    expect(entry.senses.every((sense) => sense.reviewEnabled && sense.review)).toBe(true)
  })

  it('keeps an unknown word as an entry to fill in later', () => {
    const rows = blankVocabularyRows('  zzzznotaword  ')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ lemma: 'zzzznotaword', definition: '' })
    const prepared = prepareVocabularyImport(rows, [], 'merge', ['meaning'], ids(), '2026-08-19T00:00:00.000Z')
    expect(prepared.newCount).toBe(1)
    // No meaning yet, so no card with a blank back.
    expect(prepared.entries[0].senses).toHaveLength(0)
    expect(blankVocabularyRows('   ')).toEqual([])
  })
})
