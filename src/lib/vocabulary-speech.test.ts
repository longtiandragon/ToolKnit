import { describe, expect, it } from 'vitest'
import { vocabularySpeechLocale, vocabularySpeechTarget } from './vocabulary-speech'

describe('vocabulary speech', () => {
  it('maps the editable language labels to platform speech locales', () => {
    expect(vocabularySpeechLocale('英语')).toBe('en-US')
    expect(vocabularySpeechLocale('日语')).toBe('ja-JP')
    expect(vocabularySpeechLocale('zh-CN')).toBe('zh-CN')
  })

  it('lets an unknown language use the system voice fallback', () => {
    expect(vocabularySpeechLocale('其他')).toBe('')
  })

  it('normalizes only the spoken lemma and never reads definitions aloud', () => {
    expect(vocabularySpeechTarget({ lemma: '  run   out  ', language: '英语' })).toEqual({
      text: 'run out',
      locale: 'en-US',
    })
  })
})
