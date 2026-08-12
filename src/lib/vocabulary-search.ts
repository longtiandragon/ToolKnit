import type { VocabularyEntry } from '@/types'

/**
 * Keep the list, command palette fallback and vocabulary editor aligned on
 * what “search a word” means.  A word is more than its lemma: users often
 * remember an inflection, an example, or a confusing near-synonym first.
 */
export function vocabularySearchText(entry: VocabularyEntry) {
  const forms = Object.entries(entry.forms)
    .flatMap(([label, value]) => [label, value])
    .filter((value) => value.trim())
  const senses = entry.senses.flatMap((sense) => [
    sense.partOfSpeech,
    sense.definition,
    ...sense.examples,
    ...sense.collocations,
    ...sense.synonyms,
  ])

  return [entry.lemma, entry.pronunciation ?? '', entry.language, ...forms, ...senses]
    .join('\n')
    .toLocaleLowerCase('zh-CN')
}

export function matchesVocabularySearch(entry: VocabularyEntry, query: string) {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  return !needle || vocabularySearchText(entry).includes(needle)
}
