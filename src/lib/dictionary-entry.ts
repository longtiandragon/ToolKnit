import { splitDefinitionSenses, type VocabularyImportRow } from '@/lib/vocabulary-import'

/** One ECDICT row, as `lookup_dictionary_words` returns it. */
export interface DictionaryRecord {
  word: string
  phonetic: string
  translation: string
  definition: string
  exchange: string
  /** What the reader typed, which can differ from the word that was found. */
  query: string
}

/** ECDICT writes inflections as `类型:词/类型:词`. These are the codes it uses;
 * `1` (variant of the lemma) is deliberately absent — it names a relationship
 * to another entry rather than a form of this word. */
const EXCHANGE_FORM_KEYS: Record<string, string> = {
  '0': 'base',
  p: 'past',
  d: 'participle',
  i: 'presentParticiple',
  '3': 'thirdPerson',
  r: 'comparative',
  t: 'superlative',
  s: 'plural',
}

export function dictionaryFormsFromExchange(exchange: string) {
  const forms: Record<string, string> = {}
  for (const part of String(exchange ?? '').split('/')) {
    const [code, value] = part.split(':')
    const key = EXCHANGE_FORM_KEYS[code?.trim()]
    const form = value?.trim()
    if (key && form) forms[key] = form
  }
  return forms
}

/** The dictionary stores a bare phonetic; the editor shows it bracketed. */
function bracketedPhonetic(phonetic: string) {
  const value = String(phonetic ?? '').trim()
  if (!value) return ''
  return /^[[/].*[\]/]$/.test(value) ? value : `[${value}]`
}

/**
 * Turns one dictionary record into importer rows — one row per sense, which is
 * exactly what `prepareVocabularyImport` consumes. Nothing here writes to the
 * store: the completion path reuses the import pipeline rather than growing a
 * second way to create an entry.
 */
export function dictionaryRecordToRows(record: DictionaryRecord, language = '英语'): VocabularyImportRow[] {
  const lemma = String(record.word ?? '').trim()
  if (!lemma) return []
  const pronunciation = bracketedPhonetic(record.phonetic)
  const forms = dictionaryFormsFromExchange(record.exchange)
  // The Chinese gloss is the one being learned from; the English definition is
  // the fallback for the entries that only carry one.
  const meaning = String(record.translation ?? '').trim() || String(record.definition ?? '').trim()
  const senses = splitDefinitionSenses(meaning)
  const base = { lemma, language, pronunciation, examples: [], collocations: [], synonyms: [], forms }
  // A word the dictionary knows but cannot gloss is still worth keeping, so it
  // becomes a row with no meaning rather than no row at all.
  if (!senses.length) return [{ line: 1, partOfSpeech: '', definition: '', ...base }]
  return senses.map((sense, index) => ({
    line: index + 1,
    partOfSpeech: sense.partOfSpeech,
    definition: sense.definition,
    ...base,
  }))
}

/** Rows for a word the dictionary does not know, so typing it still produces an
 * entry to fill in later instead of silently doing nothing. */
export function blankVocabularyRows(word: string, language = '英语'): VocabularyImportRow[] {
  const lemma = word.trim()
  if (!lemma) return []
  return [{ line: 1, lemma, language, pronunciation: '', partOfSpeech: '', definition: '', examples: [], collocations: [], synonyms: [], forms: {} }]
}
