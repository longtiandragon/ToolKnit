import type { QuestionReviewFacet, ReviewState, StudyDocument } from '@/types'
import { questionSourceMarkdown } from './question-source'

export interface QuestionReviewCard {
  facet: QuestionReviewFacet
  review: ReviewState
}

export const questionReviewFacetOrder: readonly QuestionReviewFacet[] = ['answer', 'error']

export const questionReviewFacetLabels: Record<QuestionReviewFacet, string> = {
  answer: '答案回忆',
  error: '错因复盘'
}

/** Existing questions only have `review`; interpreting it as the answer card
 * keeps every old due date and FSRS state exactly where it was. */
export function questionReviewCards(document: StudyDocument): QuestionReviewCard[] {
  if (document.kind !== 'question') return []
  return questionReviewFacetOrder.flatMap((facet) => {
    const review = facet === 'answer' ? document.review : document.reviewFacets?.[facet]
    return review ? [{ facet, review }] : []
  })
}

export function questionReviewForFacet(document: StudyDocument, facet: QuestionReviewFacet) {
  return facet === 'answer' ? document.review : document.reviewFacets?.[facet]
}

export function withQuestionReviewFacet(document: StudyDocument, facet: QuestionReviewFacet, review?: ReviewState): StudyDocument {
  if (facet === 'answer') {
    const next = { ...document, review }
    return { ...next, reviewEnabled: questionReviewCards(next).length > 0 }
  }
  const facets = { ...document.reviewFacets }
  if (review) facets[facet] = review
  else delete facets[facet]
  const next = { ...document, reviewFacets: Object.keys(facets).length ? facets : undefined }
  return { ...next, reviewEnabled: questionReviewCards(next).length > 0 }
}

export function createQuestionReviewState(at = new Date().toISOString()): ReviewState {
  return { due: at, intervalDays: 0, repetitions: 0, lapses: 0 }
}

function structuredQuestionStem(document: StudyDocument) {
  if (document.questionDetails?.stem.trim()) {
    return [questionSourceMarkdown(document.questionDetails.source), `## 题目\n\n${document.questionDetails.stem}`].filter(Boolean).join('\n\n')
  }
  return document.content.split('## 正确解法')[0]
}

/** Builds the visible card without rewriting the document Markdown. */
export function questionReviewFront(document: StudyDocument, facet: QuestionReviewFacet) {
  const stem = structuredQuestionStem(document)
  if (facet === 'answer') return stem
  const wrongAnswer = document.questionDetails?.wrongAnswer.trim()
  return [
    '> 复盘提示：回想当时为什么会错，再查看原因。',
    stem,
    wrongAnswer && `## 当时的错误做法\n\n${wrongAnswer}`
  ].filter(Boolean).join('\n\n')
}

/** A scheduled card can outlive an unfinished/imported question body. Keep
 * that recoverable state visible instead of presenting an apparently broken
 * blank review surface. Front matter alone does not count as a prompt. */
export function hasQuestionReviewFront(document: StudyDocument, facet: QuestionReviewFacet) {
  return questionReviewFront(document, facet).replace(/^---[\s\S]*?---\s*/, '').trim().length > 0
}

export function questionReviewBack(document: StudyDocument, facet: QuestionReviewFacet) {
  const details = document.questionDetails
  if (facet === 'error') {
    return [
      details?.errorReason.trim() && `## 错误原因\n\n${details.errorReason}`,
      details?.explanation.trim() && `## 应该记住的原则\n\n${details.explanation}`,
      details?.answer.trim() && `## 正确答案\n\n${details.answer}`
    ].filter(Boolean).join('\n\n')
  }
  if (details && [details.answer, details.explanation].some((value) => value.trim())) {
    return [
      details.answer.trim() && `## 答案 / 结论\n\n${details.answer}`,
      details.explanation.trim() && `## 解析 / 正确思路\n\n${details.explanation}`
    ].filter(Boolean).join('\n\n')
  }
  return document.content.includes('## 正确解法') ? `## 正确解法${document.content.split('## 正确解法')[1]}` : ''
}
