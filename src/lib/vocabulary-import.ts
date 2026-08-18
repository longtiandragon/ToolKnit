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
  /** Selected card directions that could not be created because their source
   * material (an example or comparison term) is missing. */
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

/** Part-of-speech markers as every dictionary export writes them. A blob like
 * `n. 手段；方法 vt. 意味着` is two senses, and splitting it here is what saves
 * the reader from retyping a word list they already own. */
const PART_OF_SPEECH_PATTERN = /(?:^|[\s；;，,、/|])((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|aux|int|interj|abbr|pl|det|模|名|动|形|副)\.)\s*/gi

/** Anki writes HTML into plain-text exports, and a stray `<div>` in a
 * definition is noise the reader would have to clean up by hand. */
function stripHtml(value: string) {
  return value
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:div|p|li|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function looksLikePronunciation(value: string) {
  return /^[[/].*[\]/]$/.test(value.trim())
}

/** Splits a trailing or leading phonetic out of a word field, so `run [rʌn]`
 * imports as a word and its pronunciation rather than a word nobody can find. */
function extractPronunciation(value: string) {
  const match = value.match(/[[/]([^\]/]{1,120})[\]/]\s*$/)
  if (!match) return { text: value.trim(), pronunciation: '' }
  return { text: value.slice(0, match.index).trim(), pronunciation: match[0].trim() }
}

/** Returns one entry per part of speech found in a definition blob. A blob
 * without any marker stays a single sense with whatever the column said. */
export function splitDefinitionSenses(definition: string, partOfSpeech = '') {
  const text = definition.trim()
  if (!text) return []
  if (partOfSpeech.trim()) return [{ partOfSpeech: partOfSpeech.trim(), definition: text }]
  const matches = [...text.matchAll(PART_OF_SPEECH_PATTERN)]
  if (!matches.length) return [{ partOfSpeech: '', definition: text }]
  const senses: Array<{ partOfSpeech: string; definition: string }> = []
  const leading = text.slice(0, matches[0].index).trim()
  if (leading) senses.push({ partOfSpeech: '', definition: leading })
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length
    const body = text.slice(start, end).replace(/^[\s；;，,、/|]+|[\s；;，,、/|]+$/g, '').trim()
    if (body) senses.push({ partOfSpeech: match[1].toLocaleLowerCase('en-US'), definition: body })
  })
  return senses.length ? senses : [{ partOfSpeech: '', definition: text }]
}

function parseDelimitedLine(line: string, delimiter: string) {
  if (delimiter === '\t') return line.split('\t').map(value => value.trim())
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index += 1 }
      else quoted = !quoted
    } else if (character === delimiter && !quoted) { fields.push(field.trim()); field = '' }
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

function validRow(row: VocabularyImportRow, allowMissingDefinition = false) {
  if (!row.lemma) return '缺少单词'
  if (!row.definition && !allowMissingDefinition) return '缺少释义'
  if (row.lemma.length > 120) return '单词超过 120 个字符'
  if (row.definition.length > 2_000) return '释义超过 2,000 个字符'
  if (row.pronunciation.length > 240) return '音标或读音超过 240 个字符'
  return ''
}

/** Anki's plain-text export leads with `#separator:` / `#html:` directives.
 * Reading them is the difference between a clean import and a file of tags. */
function ankiDirectives(lines: string[]) {
  const separators: Record<string, string> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ' }
  let delimiter: string | undefined
  let html = false
  for (const line of lines) {
    if (!line.startsWith('#')) continue
    const [key, value = ''] = line.slice(1).split(':', 2).map((part) => part.trim().toLocaleLowerCase('en-US'))
    if (key === 'separator') delimiter = separators[value] ?? (value.length === 1 ? value : undefined)
    if (key === 'html' && value === 'true') html = true
  }
  return { delimiter, html }
}

export function parseVocabularyImport(source: string): VocabularyImportParseResult {
  const bounded = source.slice(0, MAX_VOCABULARY_IMPORT_CHARS)
  const sourceTruncated = bounded.length !== source.length
  const lines = bounded.replace(/^\uFEFF/, '').split(/\r?\n/)
  const directives = ankiDirectives(lines)
  const meaningful = lines.map((text, index) => ({ text: text.trim(), line: index + 1 })).filter(item => item.text && !item.text.startsWith('#'))
  const first = meaningful[0]?.text ?? ''
  const delimiter: string | undefined = directives.delimiter
    ?? (first.includes('\t') ? '\t' : first.includes(',') ? ',' : undefined)
  const firstFields = delimiter ? parseDelimitedLine(first, delimiter) : []
  const headerMapping = Object.fromEntries(firstFields.flatMap((field, index) => {
    const key = HEADER_ALIASES[normalizedHeader(field)]
    return key ? [[key, index]] : []
  })) as Record<string, number>
  const hasHeader = Boolean(headerMapping.lemma !== undefined && headerMapping.definition !== undefined)
  const rows: VocabularyImportRow[] = []
  const issues: VocabularyImportIssue[] = []
  const candidates = meaningful.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + MAX_VOCABULARY_IMPORT_ROWS)

  const parsed: VocabularyImportRow[] = []
  for (const candidate of candidates) {
    let row: VocabularyImportRow
    if (delimiter) {
      // Per field, never on the whole line: stripping HTML collapses runs of
      // whitespace, and doing it first would eat the delimiter itself.
      const fields = parseDelimitedLine(candidate.text, delimiter).map((field) => directives.html || field.includes('<') ? stripHtml(field) : field)
      // A word-list export writes `word [phonetic] meaning`, not the column
      // order this tool invented, so the phonetic is placed by shape.
      const positional = fields.length > 2 && looksLikePronunciation(fields[1] ?? '')
        ? { lemma: 0, pronunciation: 1, definition: 2, partOfSpeech: 3, examples: 4, collocations: 5, synonyms: 6 }
        : { lemma: 0, definition: 1, partOfSpeech: 2, examples: 3, collocations: 4, synonyms: 5, pronunciation: 6 }
      row = rowFromFields(fields, hasHeader ? headerMapping : positional, candidate.line)
    } else {
      const text = directives.html || candidate.text.includes('<') ? stripHtml(candidate.text) : candidate.text
      const parts = text.split(/(?:\s+-\s+|^-\s+|\s*[—–:：]\s*)/, 2)
      row = { line: candidate.line, lemma: parts[0]?.trim() ?? '', language: '英语', pronunciation: '', partOfSpeech: '', definition: parts[1]?.trim() ?? '', examples: [], collocations: [], synonyms: [], forms: {} }
    }
    if (!row.pronunciation) {
      const split = extractPronunciation(row.lemma)
      row = { ...row, lemma: split.text, pronunciation: split.pronunciation }
    }
    parsed.push(row)
  }

  // Nothing carried a meaning, so this is a plain word list — the export every
  // flashcard app offers. Taking the words alone beats rejecting the file.
  const wordListOnly = parsed.length > 0 && parsed.every((row) => !row.definition)
  for (const row of parsed) {
    const error = validRow(row, wordListOnly)
    if (error) {
      issues.push({ line: row.line, message: error, preview: (lines[row.line - 1] ?? '').trim().slice(0, 120) })
      continue
    }
    // One line can hold several parts of speech; each becomes its own sense so
    // nobody has to retype what the export already said.
    const senses = splitDefinitionSenses(row.definition, row.partOfSpeech)
    if (!senses.length) rows.push(row)
    else for (const sense of senses) rows.push({ ...row, partOfSpeech: sense.partOfSpeech, definition: sense.definition })
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
  if (facet === 'example') return sense.examples.some((example) => example.trim())
  if (facet === 'comparison') return sense.synonyms.some((synonym) => synonym.trim())
  return true
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

/**
 * Ids of the entries a merge is about to touch. Desktop list rows omit their
 * senses, so merging against them would re-insert meanings the row could not
 * see; the caller reads these entries in full first.
 */
export function vocabularyImportDuplicateIds(
  rows: readonly VocabularyImportRow[],
  entries: readonly VocabularyEntry[],
) {
  const keys = new Set(rows.map((row) => entryKey(row.lemma, row.language)))
  return entries
    .filter((entry) => entry.summaryOnly && keys.has(entryKey(entry.lemma, entry.language)))
    .map((entry) => entry.id)
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
      // A word list carries no meaning yet. The word is still worth keeping;
      // an empty sense would only be a review card with nothing on it.
      if (!row.definition.trim()) continue
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
    // A word list has no meanings yet and the word itself is what is being
    // imported, so only an existing entry that gained nothing is skipped.
    if (!entry.senses.length && current) { skippedCount += group.length; continue }
    if (!entryChanged) continue
    entry.updatedAt = now
    entries.push(entry)
    if (current) updatedCount += 1
    else newCount += 1
  }
  return { entries, newCount, updatedCount, skippedCount, addedSenseCount, reviewCardCount, skippedReviewCardCount }
}
