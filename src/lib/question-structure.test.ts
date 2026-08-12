import { describe, expect, it } from 'vitest'
import { matchesQuestionType, questionStructureSummary, questionTypeLabel } from './question-structure'

describe('question structure', () => {
  it('keeps every structured learning field visible in a stable order', () => {
    const summary = questionStructureSummary({
      source: '课程第 2 讲',
      stem: '题目',
      answer: '答案',
      explanation: '',
      wrongAnswer: '错误尝试',
      errorReason: '',
    })
    expect(summary.items.map((item) => item.key)).toEqual(['source', 'stem', 'answer', 'explanation', 'wrongAnswer', 'errorReason'])
    expect(summary).toMatchObject({ completed: 3, total: 5, nextField: 'explanation' })
  })

  it('treats whitespace-only fields as incomplete', () => {
    expect(questionStructureSummary({ source: ' ', stem: '  ', answer: '', explanation: '', wrongAnswer: '', errorReason: '' })).toMatchObject({ completed: 0, nextField: 'stem' })
  })

  it('provides a safe label for older questions without a type', () => {
    expect(questionTypeLabel('algorithm')).toBe('算法 / 编程')
    expect(questionTypeLabel(undefined)).toBe('通用')
  })

  it('keeps legacy questions discoverable through the general type filter', () => {
    expect(matchesQuestionType(undefined, 'general')).toBe(true)
    expect(matchesQuestionType('algorithm', 'general')).toBe(false)
    expect(matchesQuestionType('algorithm', '')).toBe(true)
  })
})
