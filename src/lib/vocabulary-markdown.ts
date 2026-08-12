import type { VocabularyEntry } from '@/types'

function nonEmpty(value: string | undefined) {
  return value?.trim() || ''
}

function listSection(label: string, values: string[]) {
  const items = values.map((value) => value.trim()).filter(Boolean)
  return items.length ? [`**${label}**`, ...items.map((item) => `- ${item}`), ''] : []
}

/** Creates a portable Markdown snapshot without exposing local review state. */
export function vocabularyToMarkdown(entry: VocabularyEntry) {
  const lemma = nonEmpty(entry.lemma) || '未命名词条'
  const lines = [`# ${lemma}`, '']
  const metadata = [
    ['语言', nonEmpty(entry.language)],
    ['读音', nonEmpty(entry.pronunciation)],
  ]
  for (const [label, value] of metadata) if (value) lines.push(`- ${label}：${value}`)

  const forms = Object.entries(entry.forms)
    .map(([label, value]) => [label, nonEmpty(value)] as const)
    .filter(([, value]) => value)
  if (forms.length) {
    lines.push('', '## 词形')
    for (const [label, value] of forms) lines.push(`- ${label}：${value}`)
  }

  lines.push('', '## 词义')
  entry.senses.forEach((sense, index) => {
    lines.push('', `### ${index + 1}. ${nonEmpty(sense.partOfSpeech) || '未分类'}`)
    const definition = nonEmpty(sense.definition)
    if (definition) lines.push('', definition)
    lines.push('', ...listSection('例句', sense.examples), ...listSection('常用搭配', sense.collocations), ...listSection('近义 / 易混', sense.synonyms))
  })
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
