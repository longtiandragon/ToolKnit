import type { VocabularyEntry, VocabularyReviewFacet, VocabularySense } from '@/types'
import { cloneVocabularyEntry } from '@/lib/vocabulary'
import { createVocabularyReviewState, vocabularyReviewForFacet, withVocabularyReviewFacet } from '@/lib/vocabulary-review'

export const MAX_VOCABULARY_IMPORT_CHARS = 1_000_000
export const MAX_VOCABULARY_IMPORT_ROWS = 5_000

export interface VocabularyImportRow {
  line: number
  lemma: string
  language: string
  pronunciation: string
  partOfSpeech: string
  definition: string
  examples: string[]
  collocations: string[]
  synonyms: string[]
  forms: Record<string, string>
}

export interface VocabularyImportIssue { line: number; message: string; preview: string }
export interface VocabularyImportParseResult {
  rows: VocabularyImportRow[]
  issues: VocabularyImportIssue[]
  format: 'table' | 'simple'
  truncated: boolean
}

export type VocabularyImportDuplicatePolicy = 'skip' | 'merge'

export interface VocabularyImportPreparation {
  entries: VocabularyEntry[]
  newCount: number
  updatedCount: number
  skippedCount: number
  addedSenseCount: number
  /** Number of genuinely new FSRS cards created by this import. Existing
   * schedules are never counted or reset. */
  reviewCardCount: number
  /** Selected card directions that could not be created. At present this is
   * limited to example-cloze cards whose sense has no example sentence. */
  skippedReviewCardCount: number
}

export type VocabularyImportReviewSelection = boolean | readonly VocabularyReviewFacet[]

const HEADER_ALIASES: Record<string, string> = {
  word: 'lemma', lemma: 'lemma', term: 'lemma', 单词: 'lemma', 词条: 'lemma',
  language: 'language', lang: 'language', 语言: 'language',
  pronunciation: 'pronunciation', phonetic: 'pronunciation', ipa: 'pronunciation', 音标: 'pronunciation', 发音: 'pronunciation',
  partofspeech: 'partOfSpeech', pos: 'partOfSpeech', 词性: 'partOfSpeech',
  definition: 'definition', meaning: 'definition', 释义: 'definition', 词义: 'definition', 中文: 'definition',
  example: 'examples', examples: 'examples', sentence: 'examples', 例句: 'examples',
  collocation: 'collocations', collocations: 'collocations', phrase: 'collocations', 搭配: 'collocations', 常用搭配: 'collocations', 词组: 'collocations',
  synonym: 'synonyms', synonyms: 'synonyms', confusing: 'synonyms', 近义词: 'synonyms', 易混词: 'synonyms',
  base: 'base', 原形: 'base', past: 'past', 过去式: 'past', participle: 'participle', pastparticiple: 'participle', 过去分词: 'participle',
  presentparticiple: 'presentParticiple', ing: 'presentParticiple', 现在分词: 'presentParticiple',
}

function normalizedHeader(value: string) {
  return value.trim().toLocaleLowerCase('en-US').replace(/[\s_\-/]+/g, '')
}

function list(value = '') {
  return [...new Set(value.split(/[；;|\n]/).map(item => item.trim()).filter(Boolean))].slice(0, 50)
}

function parseDelimitedLine(line: string, delimiter: '\t' | ',') {
  if (delimiter === '\t') return line.split('\t').map(value => value.trim())
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index += 1 }
      else quoted = !quoted
    } else if (character === ',' && !quoted) { fields.push(field.trim()); field = '' }
    else field += character
  }
  fields.push(field.trim())
  return fields
}

function rowFromFields(fields: string[], mapping: Record<string, number>, line: number): VocabularyImportRow {
  const at = (key: string) => fields[mapping[key] ?? -1]?.trim() ?? ''
  const forms = Object.fromEntries(['base', 'past', 'participle', 'presentParticiple'].flatMap(key => at(key) ? [[key, at(key)]] : []))
  return {
    line,
    lemma: at('lemma'),
    language: at('language') || '英语',
    pronunciation: at('pronunciation'),
    partOfSpeech: at('partOfSpeech'),
    definition: at('definition'),
    examples: list(at('examples')),
    collocations: list(at('collocations')),
    synonyms: list(at('synonyms')),
    forms,
  }
}

function validRow(row: VocabularyImportRow) {
  if (!row.lemma) return '缺少单词'
  if (!row.definition) return '缺少释义'
  if (row.lemma.length > 120) return '单词超过 120 个字符'
  if (row.definition.length > 2_000) return '释义超过 2,000 个字符'
  if (row.pronunciation.length > 240) return '音标或读音超过 240 个字符'
  return ''
}

export function parseVocabularyImport(source: string): VocabularyImportParseResult {
  const bounded = source.slice(0, MAX_VOCABULARY_IMPORT_CHARS)
  const sourceTruncated = bounded.length !== source.length
  const lines = bounded.replace(/^\uFEFF/, '').split(/\r?\n/)
  const meaningful = lines.map((text, index) => ({ text: text.trim(), line: index + 1 })).filter(item => item.text && !item.text.startsWith('#'))
  const first = meaningful[0]?.text ?? ''
  const delimiter: '\t' | ',' | undefined = first.includes('\t') ? '\t' : first.includes(',') ? ',' : undefined
  const firstFields = delimiter ? parseDelimitedLine(first, delimiter) : []
  const headerMapping = Object.fromEntries(firstFields.flatMap((field, index) => {
    const key = HEADER_ALIASES[normalizedHeader(field)]
    return key ? [[key, index]] : []
  })) as Record<string, number>
  const hasHeader = Boolean(headerMapping.lemma !== undefined && headerMapping.definition !== undefined)
  const rows: VocabularyImportRow[] = []
  const issues: VocabularyImportIssue[] = []
  const candidates = meaningful.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + MAX_VOCABULARY_IMPORT_ROWS)

  for (const candidate of candidates) {
    let row: VocabularyImportRow
    if (delimiter) {
      const fields = parseDelimitedLine(candidate.text, delimiter)
      const mapping = hasHeader ? headerMapping : { lemma: 0, definition: 1, partOfSpeech: 2, examples: 3, collocations: 4, synonyms: 5, pronunciation: 6 }
      row = rowFromFields(fields, mapping, candidate.line)
    } else {
      const parts = candidate.text.split(/(?:\s+-\s+|^-\s+|\s*[—–:：]\s*)/, 2)
      row = { line: candidate.line, lemma: parts[0]?.trim() ?? '', language: '英语', pronunciation: '', partOfSpeech: '', definition: parts[1]?.trim() ?? '', examples: [], collocations: [], synonyms: [], forms: {} }
    }
    const error = validRow(row)
    if (error) issues.push({ line: candidate.line, message: error, preview: candidate.text.slice(0, 120) })
    else rows.push(row)
  }
  const truncated = sourceTruncated || meaningful.length - Number(hasHeader) > MAX_VOCABULARY_IMPORT_ROWS
  if (sourceTruncated) issues.unshift({ line: 0, message: '输入超过 1,000,000 字符，只解析了前半部分', preview: '' })
  else if (truncated) issues.unshift({ line: 0, message: '单次最多解析 5,000 行，其余内容未处理', preview: '' })
  return { rows, issues, format: delimiter ? 'table' : 'simple', truncated }
}

function entryKey(lemma: string, language: string) {
  return `${lemma.trim().toLocaleLowerCase('en-US')}\u0000${language.trim().toLocaleLowerCase('zh-CN')}`
}

function senseKey(sense: Pick<VocabularySense, 'partOfSpeech' | 'definition'>) {
  return `${sense.partOfSpeech.trim().toLocaleLowerCase('en-US')}\u0000${sense.definition.trim().toLocaleLowerCase('zh-CN')}`
}

function selectedReviewFacets(selection: VocabularyImportReviewSelection) {
  return new Set<VocabularyReviewFacet>(typeof selection === 'boolean' ? (selection ? ['meaning'] : []) : selection)
}

function canCreateReviewFacet(sense: VocabularySense, facet: VocabularyReviewFacet) {
  return facet !== 'example' || sense.examples.some((example) => example.trim())
}

/** Add only missing directions. This preserves every existing due date and
 * lets a merge add an example card after an example sentence is imported. */
function addSelectedReviewFacets(
  sense: VocabularySense,
  facets: ReadonlySet<VocabularyReviewFacet>,
  at: string,
) {
  let next = sense
  let added = 0
  let skipped = 0
  for (const facet of facets) {
    if (vocabularyReviewForFacet(next, facet)) continue
    if (!canCreateReviewFacet(next, facet)) { skipped += 1; continue }
    next = withVocabularyReviewFacet(next, facet, createVocabularyReviewState(at))
    added += 1
  }
  return { sense: next, added, skipped }
}

export function prepareVocabularyImport(
  rows: VocabularyImportRow[],
  existing: VocabularyEntry[],
  policy: VocabularyImportDuplicatePolicy,
  reviewSelection: VocabularyImportReviewSelection,
  idFactory: () => string = () => crypto.randomUUID(),
  now = new Date().toISOString(),
): VocabularyImportPreparation {
  const reviewFacets = selectedReviewFacets(reviewSelection)
  const existingByKey = new Map(existing.map(entry => [entryKey(entry.lemma, entry.language), entry]))
  const grouped = new Map<string, VocabularyImportRow[]>()
  for (const row of rows) {
    const key = entryKey(row.lemma, row.language)
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  const entries: VocabularyEntry[] = []
  let newCount = 0
  let updatedCount = 0
  let skippedCount = 0
  let addedSenseCount = 0
  let reviewCardCount = 0
  let skippedReviewCardCount = 0

  for (const [key, group] of grouped) {
    const current = existingByKey.get(key)
    if (current && policy === 'skip') { skippedCount += group.length; continue }
    const entry = current ? cloneVocabularyEntry(current) : {
      id: idFactory(), lemma: group[0].lemma, language: group[0].language, pronunciation: '', forms: {}, senses: [], createdAt: now, updatedAt: now,
    }
    const knownSenses = new Map(entry.senses.map(sense => [senseKey(sense), sense]))
    let entryChanged = !current
    for (const row of group) {
      if (!entry.pronunciation && row.pronunciation) { entry.pronunciation = row.pronunciation; entryChanged = true }
      const nextForms = Object.fromEntries(Object.entries(row.forms).filter(([key, value]) => value && entry.forms[key] !== value))
      if (Object.keys(nextForms).length) { entry.forms = { ...entry.forms, ...nextForms }; entryChanged = true }
      let candidate: VocabularySense = {
        id: idFactory(), partOfSpeech: row.partOfSpeech, definition: row.definition, examples: row.examples, collocations: row.collocations, synonyms: row.synonyms,
        reviewEnabled: false,
      }
      const candidateKey = senseKey(candidate)
      const known = knownSenses.get(candidateKey)
      if (known) {
        const mergeList = (left: string[], right: string[]) => [...new Set([...left, ...right])]
        const examples = mergeList(known.examples, candidate.examples)
        const collocations = mergeList(known.collocations, candidate.collocations)
        const synonyms = mergeList(known.synonyms, candidate.synonyms)
        const metadataChanged = examples.length !== known.examples.length || collocations.length !== known.collocations.length || synonyms.length !== known.synonyms.length
        known.examples = examples
        known.collocations = collocations
        known.synonyms = synonyms
        const reviewed = addSelectedReviewFacets(known, reviewFacets, now)
        if (reviewed.sense !== known) Object.assign(known, reviewed.sense)
        reviewCardCount += reviewed.added
        skippedReviewCardCount += reviewed.skipped
        if (!metadataChanged && !reviewed.added) { skippedCount += 1; continue }
        entryChanged = true
        continue
      }
      const reviewed = addSelectedReviewFacets(candidate, reviewFacets, now)
      candidate = reviewed.sense
      reviewCardCount += reviewed.added
      skippedReviewCardCount += reviewed.skipped
      knownSenses.set(candidateKey, candidate)
      entry.senses.push(candidate)
      addedSenseCount += 1
      entryChanged = true
    }
    if (!entry.senses.length) { skippedCount += group.length; continue }
    if (!entryChanged) continue
    entry.updatedAt = now
    entries.push(entry)
    if (current) updatedCount += 1
    else newCount += 1
  }
  return { entries, newCount, updatedCount, skippedCount, addedSenseCount, reviewCardCount, skippedReviewCardCount }
}
