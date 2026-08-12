import type { QuestionDetails, QuestionType } from '@/types'

export type QuestionStructureField = keyof QuestionDetails

export const questionTypeChoices: ReadonlyArray<{ value: QuestionType; label: string }> = [
  { value: 'algorithm', label: '算法 / 编程' },
  { value: 'math', label: '数学' },
  { value: 'science', label: '理科' },
  { value: 'general', label: '通用' },
]

export const questionStructureFields: ReadonlyArray<{ key: QuestionStructureField; label: string; shortLabel: string; required: boolean }> = [
  { key: 'source', label: '来源 / 出处', shortLabel: '来源', required: false },
  { key: 'stem', label: '题干', shortLabel: '题干', required: true },
  { key: 'answer', label: '答案 / 结论', shortLabel: '答案', required: true },
  { key: 'explanation', label: '解析 / 正确思路', shortLabel: '解析', required: true },
  { key: 'wrongAnswer', label: '当时的错误做法', shortLabel: '错误做法', required: true },
  { key: 'errorReason', label: '错误原因', shortLabel: '错因', required: true },
]

export function questionTypeLabel(type: QuestionType | undefined) {
  return questionTypeChoices.find((choice) => choice.value === type)?.label ?? '通用'
}

export function matchesQuestionType(type: QuestionType | undefined, filter: QuestionType | '') {
  return !filter || (type ?? 'general') === filter
}

export function questionStructureSummary(details: QuestionDetails | undefined) {
  const items = questionStructureFields.map((field) => ({
    ...field,
    complete: Boolean(details?.[field.key]?.trim()),
  }))
  const requiredItems = items.filter((item) => item.required)
  const completed = requiredItems.filter((item) => item.complete).length
  return {
    items,
    completed,
    total: requiredItems.length,
    nextField: requiredItems.find((item) => !item.complete)?.key,
  }
}
