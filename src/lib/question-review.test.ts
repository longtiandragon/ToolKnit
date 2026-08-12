import { describe, expect, it } from 'vitest'
import type { StudyDocument } from '@/types'
import { createQuestionReviewState, hasQuestionReviewFront, questionReviewBack, questionReviewCards, questionReviewForFacet, questionReviewFront, withQuestionReviewFacet } from './question-review'

function question(): StudyDocument {
  return {
    id: 'question-1', title: '边界条件', kind: 'question', subject: '算法', tags: [], difficulty: 3,
    content: '', questionDetails: { source: '', stem: '为什么越界？', answer: '检查端点。', explanation: '', wrongAnswer: '直接访问。', errorReason: '忽略空数组。' },
    createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', reviewEnabled: false, errorTypes: []
  }
}

describe('question review facets', () => {
  it('keeps the legacy review as the answer card', () => {
    const answer = createQuestionReviewState('2026-08-11T00:00:00.000Z')
    const document = { ...question(), reviewEnabled: true, review: answer }
    expect(questionReviewCards(document)).toEqual([{ facet: 'answer', review: answer }])
    expect(questionReviewForFacet(document, 'answer')).toBe(answer)
  })

  it('adds and removes an independent error card without changing the answer schedule', () => {
    const answer = createQuestionReviewState('2026-08-11T00:00:00.000Z')
    const error = createQuestionReviewState('2026-08-12T00:00:00.000Z')
    const withAnswer = withQuestionReviewFacet(question(), 'answer', answer)
    const withError = withQuestionReviewFacet(withAnswer, 'error', error)
    expect(questionReviewCards(withError).map(({ facet }) => facet)).toEqual(['answer', 'error'])
    expect(withQuestionReviewFacet(withError, 'error').review).toEqual(answer)
    expect(withQuestionReviewFacet(withError, 'error').reviewEnabled).toBe(true)
  })

  it('disables review after the final facet is removed', () => {
    const enabled = withQuestionReviewFacet(question(), 'error', createQuestionReviewState())
    const disabled = withQuestionReviewFacet(enabled, 'error')
    expect(disabled.reviewEnabled).toBe(false)
    expect(disabled.reviewFacets).toBeUndefined()
  })

  it('keeps answer and error prompts focused on different recall tasks', () => {
    const document = { ...question(), questionDetails: { ...question().questionDetails!, source: '算法课程第 2 讲' } }
    expect(questionReviewFront(document, 'answer')).toContain('来源：算法课程第 2 讲')
    expect(questionReviewFront(document, 'answer')).toContain('为什么越界？')
    expect(questionReviewBack(document, 'answer')).toContain('检查端点。')
    expect(questionReviewBack(document, 'answer')).not.toContain('忽略空数组。')
    expect(questionReviewFront(document, 'error')).toContain('直接访问。')
    expect(questionReviewBack(document, 'error')).toContain('忽略空数组。')
  })

  it('distinguishes a real prompt from an unfinished scheduled card', () => {
    expect(hasQuestionReviewFront(question(), 'answer')).toBe(true)
    expect(hasQuestionReviewFront({ ...question(), content: '', questionDetails: undefined }, 'answer')).toBe(false)
    expect(hasQuestionReviewFront({ ...question(), content: '---\nsubject: 算法\n---\n', questionDetails: undefined }, 'answer')).toBe(false)
  })
})
