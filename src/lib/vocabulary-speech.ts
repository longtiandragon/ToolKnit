import type { VocabularyEntry } from '@/types'

const localeAliases: Array<[RegExp, string]> = [
  [/^(?:英语|英文|english|en)(?:[-_ ]?[a-z]+)?$/i, 'en-US'],
  [/^(?:日语|日文|日本語|japanese|ja)(?:[-_ ]?[a-z]+)?$/i, 'ja-JP'],
  [/^(?:中文|汉语|普通话|chinese|zh)(?:[-_ ]?[a-z]+)?$/i, 'zh-CN'],
  [/^(?:韩语|韩文|한국어|korean|ko)(?:[-_ ]?[a-z]+)?$/i, 'ko-KR'],
]

/** Keep the saved language label human-readable while giving the platform TTS
 * a stable BCP-47 locale. Unknown labels deliberately fall back to the host. */
export function vocabularySpeechLocale(language: string | undefined) {
  const normalized = language?.trim() ?? ''
  return localeAliases.find(([pattern]) => pattern.test(normalized))?.[1] ?? ''
}

export function vocabularySpeechTarget(entry: Pick<VocabularyEntry, 'lemma' | 'language'>) {
  return {
    text: entry.lemma.trim().replace(/\s+/g, ' '),
    locale: vocabularySpeechLocale(entry.language),
  }
}
