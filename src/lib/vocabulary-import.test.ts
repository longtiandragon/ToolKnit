import { describe, expect, it } from 'vitest'
import { parseVocabularyImport, prepareVocabularyImport } from './vocabulary-import'
import type { VocabularyEntry } from '@/types'

const ids = () => { let index = 0; return () => `00000000-0000-7000-8000-${String(index++).padStart(12, '0')}` }

describe('vocabulary batch import', () => {
  it('parses Chinese TSV headers and keeps multiple senses for one word', () => {
    const parsed = parseVocabularyImport('单词\t词性\t释义\t例句\t常用搭配\t近义词\nrun\tverb\t跑；运行\tI run daily.|The app runs.\trun a program|run out of\toperate\nrun\tnoun\t一段连续时期\tA long run.\ta long run\tperiod')
    expect(parsed.issues).toEqual([])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({ lemma: 'run', partOfSpeech: 'verb', definition: '跑；运行', examples: ['I run daily.', 'The app runs.'], collocations: ['run a program', 'run out of'] })
    const prepared = prepareVocabularyImport(parsed.rows, [], 'merge', false, ids(), '2026-08-10T00:00:00.000Z')
    expect(prepared).toMatchObject({ newCount: 1, updatedCount: 0, addedSenseCount: 2 })
    expect(prepared.entries[0].senses).toHaveLength(2)
  })

  it('parses quoted CSV and simple word-definition lines', () => {
    const csv = parseVocabularyImport('word,definition,part of speech,example\nrun,"跑, 运行",verb,"The app runs."')
    expect(csv.rows[0]).toMatchObject({ lemma: 'run', definition: '跑, 运行', partOfSpeech: 'verb' })
    expect(parseVocabularyImport('compile - 编译\ndebug：调试').rows.map(row => row.lemma)).toEqual(['compile', 'debug'])
  })

  it('reports invalid lines without discarding valid rows', () => {
    const parsed = parseVocabularyImport('run - 跑\nmissing definition\n - 空单词')
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.issues.map(issue => issue.message)).toEqual(['缺少释义', '缺少单词'])
  })

  it('merges new senses without replacing existing review state', () => {
    const existing: VocabularyEntry = {
      id: 'word-existing', lemma: 'run', language: '英语', forms: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      senses: [{ id: 'sense-existing', partOfSpeech: 'verb', definition: '跑', examples: [], collocations: [], synonyms: [], reviewEnabled: true, review: { due: '2026-08-11', intervalDays: 1, repetitions: 1, lapses: 0 } }],
    }
    const rows = parseVocabularyImport('word\tdefinition\tpart of speech\nrun\t跑\tverb\nrun\t经营\tverb').rows
    const merged = prepareVocabularyImport(rows, [existing], 'merge', true, ids(), '2026-08-10T00:00:00.000Z')
    expect(merged).toMatchObject({ newCount: 0, updatedCount: 1, skippedCount: 1, addedSenseCount: 1 })
    expect(merged.entries[0].senses[0].review?.due).toBe('2026-08-11')
    expect(merged.entries[0].senses[1].reviewEnabled).toBe(true)
  })

  it('creates selected directions and omits cards whose source material is missing', () => {
    const rows = parseVocabularyImport('单词\t释义\t例句\t易混词\nrun\t运行\tThe app runs.\toperate\ncompile\t编译\t\t').rows
    const prepared = prepareVocabularyImport(rows, [], 'merge', ['meaning', 'spelling', 'example', 'comparison'], ids(), '2026-08-10T00:00:00.000Z')

    expect(prepared).toMatchObject({ newCount: 2, addedSenseCount: 2, reviewCardCount: 6, skippedReviewCardCount: 2 })
    expect(prepared.entries[0].senses[0]).toMatchObject({
      reviewEnabled: true,
      review: { due: '2026-08-10T00:00:00.000Z' },
      reviewFacets: {
        spelling: { due: '2026-08-10T00:00:00.000Z' },
        example: { due: '2026-08-10T00:00:00.000Z' },
        comparison: { due: '2026-08-10T00:00:00.000Z' },
      },
    })
    expect(prepared.entries[1].senses[0].reviewFacets).toEqual({
      spelling: { due: '2026-08-10T00:00:00.000Z', intervalDays: 0, repetitions: 0, lapses: 0 },
    })
  })

  it('adds a missing review direction during merge without resetting an existing schedule', () => {
    const existing: VocabularyEntry = {
      id: 'word-existing', lemma: 'run', language: '英语', forms: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      senses: [{ id: 'sense-existing', partOfSpeech: 'verb', definition: '运行', examples: [], collocations: [], synonyms: [], reviewEnabled: true, review: { due: '2026-08-11', intervalDays: 4, repetitions: 2, lapses: 0 } }],
    }
    const rows = parseVocabularyImport('单词\t释义\t词性\t例句\nrun\t运行\tverb\tThe app runs.').rows
    const merged = prepareVocabularyImport(rows, [existing], 'merge', ['meaning', 'example'], ids(), '2026-08-10T00:00:00.000Z')

    expect(merged).toMatchObject({ updatedCount: 1, addedSenseCount: 0, skippedCount: 0, reviewCardCount: 1, skippedReviewCardCount: 0 })
    expect(merged.entries[0].senses[0].review?.due).toBe('2026-08-11')
    expect(merged.entries[0].senses[0].reviewFacets?.example?.due).toBe('2026-08-10T00:00:00.000Z')
  })

  it('adds collocations to an existing sense without replacing its review state', () => {
    const existing = prepareVocabularyImport(parseVocabularyImport('run - 跑').rows, [], 'merge', true, ids(), '2026-08-01T00:00:00.000Z').entries
    const review = existing[0].senses[0].review
    const rows = parseVocabularyImport('单词\t释义\t词性\t常用搭配\nrun\t跑\t\trun a program|run out of').rows
    const merged = prepareVocabularyImport(rows, existing, 'merge', false, ids(), '2026-08-10T00:00:00.000Z')
    expect(merged).toMatchObject({ updatedCount: 1, addedSenseCount: 0, skippedCount: 0 })
    expect(merged.entries[0].senses[0].collocations).toEqual(['run a program', 'run out of'])
    expect(merged.entries[0].senses[0].review).toEqual(review)
  })

  it('can skip existing words as an explicit duplicate policy', () => {
    const existing = prepareVocabularyImport(parseVocabularyImport('run - 跑').rows, [], 'merge', false, ids()).entries
    const result = prepareVocabularyImport(parseVocabularyImport('run - 经营\ncompile - 编译').rows, existing, 'skip', false, ids())
    expect(result).toMatchObject({ newCount: 1, updatedCount: 0, skippedCount: 1 })
    expect(result.entries[0].lemma).toBe('compile')
  })

  it('bounds very large imports without mounting or parsing an unbounded list', () => {
    const source = Array.from({ length: 5_001 }, (_, index) => `word${index} - 释义 ${index}`).join('\n')
    const parsed = parseVocabularyImport(source)
    expect(parsed.rows).toHaveLength(5_000)
    expect(parsed.truncated).toBe(true)
    expect(parsed.issues[0].message).toContain('5,000 行')
  })
})
