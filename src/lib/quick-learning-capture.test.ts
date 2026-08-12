import { describe, expect, it } from 'vitest'
import { parseQuickQuestionCapture, parseQuickVocabularyCapture, QUICK_LEARNING_CAPTURE_LIMIT, QUICK_VOCABULARY_SENSE_LIMIT } from './quick-learning-capture'

describe('quick learning capture', () => {
  it('parses multiple parts of speech and meanings without collapsing the word', () => {
    const result = parseQuickVocabularyCapture('run /rʌn/\n词形：过去式: ran；现在分词: running\nv. 跑；经营；运行\nn. 一段连续时期\n例句：I run every day.\n搭配：run a program；run a business\n近义词：operate')
    expect(result?.lemma).toBe('run')
    expect(result?.language).toBe('英语')
    expect(result?.pronunciation).toBe('/rʌn/')
    expect(result?.forms).toEqual({ 过去式: 'ran', 现在分词: 'running' })
    expect(result?.senses.map(item => [item.partOfSpeech, item.definition])).toEqual([
      ['verb', '跑'], ['verb', '经营'], ['verb', '运行'], ['noun', '一段连续时期'],
    ])
    expect(result?.senses.at(-1)?.examples).toEqual(['I run every day.'])
    expect(result?.senses.at(-1)?.collocations).toEqual(['run a program', 'run a business'])
    expect(result?.senses.at(-1)?.synonyms).toEqual(['operate'])
    expect(result?.confident).toBe(true)
  })

  it('infers non-English word languages and ignores unsafe form keys', () => {
    const result = parseQuickVocabularyCapture('走る\n词形：__proto__: polluted；过去式: 走った\nv. 跑')
    expect(result?.language).toBe('日语')
    expect(result?.forms).toEqual({ 过去式: '走った' })
  })

  it('only proposes vocabulary for plausible compact lemmas', () => {
    expect(parseQuickVocabularyCapture('serendipity')?.confident).toBe(true)
    expect(parseQuickVocabularyCapture('今天整理课程笔记，然后完成三道题。')).toBeUndefined()
  })

  it('parses question fields, subject and tags into structured details', () => {
    const result = parseQuickQuestionCapture('来源：算法课程第 2 讲\n题目：为什么二分答案要保持区间收缩？\n我的答案：直接移动 mid。\n答案：可行时 right = mid。\n解析：维护循环不变量。\n错因：边界理解不清\n学科：算法\n知识点：二分, 边界')
    expect(result).toMatchObject({ title: '为什么二分答案要保持区间收缩？', questionType: 'algorithm', subject: '算法', tags: ['二分', '边界'], confident: true })
    expect(result?.details).toEqual({ source: '算法课程第 2 讲', stem: '为什么二分答案要保持区间收缩？', wrongAnswer: '直接移动 mid。', answer: '可行时 right = mid。', explanation: '维护循环不变量。', errorReason: '边界理解不清' })
  })

  it('keeps unlabelled text as a recoverable question stem', () => {
    const result = parseQuickQuestionCapture('解释 TCP 三次握手的目的。')
    expect(result?.details.stem).toBe('解释 TCP 三次握手的目的。')
    expect(result?.confident).toBe(false)
  })

  it('bounds pasted input and vocabulary fan-out', () => {
    const result = parseQuickQuestionCapture('题目：' + 'x'.repeat(QUICK_LEARNING_CAPTURE_LIMIT + 20))
    expect(result?.details.stem.length).toBeLessThanOrEqual(QUICK_LEARNING_CAPTURE_LIMIT)
    expect(result?.truncated).toBe(true)
    const vocabulary = parseQuickVocabularyCapture(`word\nv. ${Array.from({ length: 30 }, (_, index) => `义项${index}`).join('；')}`)
    expect(vocabulary?.senses).toHaveLength(QUICK_VOCABULARY_SENSE_LIMIT)
  })
})
