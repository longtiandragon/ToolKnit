import { describe, expect, it } from 'vitest'
import { parseQuestionImport, prepareQuestionImport } from './question-import'
import type { StudyDocument } from '@/types'

const ids = () => { let index = 0; return () => `00000000-0000-7000-8000-${String(index++).padStart(12, '0')}` }

describe('question batch import', () => {
  it('parses Chinese TSV headers and structured learning fields', () => {
    const parsed = parseQuestionImport('标题\t来源\t题干\t答案\t解析\t我的答案\t错因\t分类\t题型\t难度\t知识点\t错误类型\n二分边界\tLeetCode 704\t为什么循环会结束？\t区间严格缩小\t每轮排除一半\t漏写 +1\t边界未收缩\t算法\t算法\t4\t二分|循环不变量\t边界条件')
    expect(parsed.issues).toEqual([])
    expect(parsed.rows[0]).toMatchObject({ title: '二分边界', source: 'LeetCode 704', subject: '算法', questionType: 'algorithm', difficulty: 4, tags: ['二分', '循环不变量'], errorTypes: ['边界条件'] })
    const prepared = prepareQuestionImport(parsed.rows, [], 'skip', true, true, ids(), '2026-08-10T00:00:00.000Z')
    expect(prepared).toMatchObject({ importedCount: 1, skippedCount: 0, reviewCardCount: 2 })
    expect(prepared.documents[0].reviewFacets?.error?.due).toBe('2026-08-10T00:00:00.000Z')
    expect(prepared.documents[0].questionDetails?.source).toBe('LeetCode 704')
  })

  it('supports quoted CSV paragraphs and a simple prompt-to-answer list', () => {
    const csv = parseQuestionImport('题干,答案,解析\n"第一行\n第二行","答案,含逗号","先观察\n再证明"')
    expect(csv.rows[0]).toMatchObject({ stem: '第一行\n第二行', answer: '答案,含逗号', explanation: '先观察\n再证明' })
    const simple = parseQuestionImport('TCP 为什么需要三次握手？ => 确认双方收发能力\n只记录一道开放题')
    expect(simple.rows.map(row => row.answer)).toEqual(['确认双方收发能力', ''])
  })

  it('reports bad rows and bounds large imports', () => {
    const parsed = parseQuestionImport('题干\t答案\n\t空题\n有效题\t答案')
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.issues[0].message).toBe('缺少题干')
    const large = parseQuestionImport(Array.from({ length: 2_001 }, (_, index) => `题目 ${index}`).join('\n'))
    expect(large.rows).toHaveLength(2_000)
    expect(large.truncated).toBe(true)
  })

  it('skips duplicates without replacing existing review progress', () => {
    const row = parseQuestionImport('标题\t题干\t答案\n二分边界\t为什么循环会结束？\t区间严格缩小').rows[0]
    const existing = prepareQuestionImport([row], [], 'skip', true, false, ids(), '2026-08-01T00:00:00.000Z').documents[0]
    const originalReview = existing.review
    const skipped = prepareQuestionImport([row], [existing], 'skip', true, true, ids(), '2026-08-10T00:00:00.000Z')
    expect(skipped).toMatchObject({ importedCount: 0, skippedCount: 1 })
    expect(existing.review).toEqual(originalReview)
    expect(prepareQuestionImport([row], [existing], 'copy', false, false, ids()).documents).toHaveLength(1)
  })

  it('does not create empty review cards', () => {
    const row = parseQuestionImport('只记录题干').rows[0]
    const result = prepareQuestionImport([row], [] as StudyDocument[], 'skip', true, true, ids())
    expect(result).toMatchObject({ reviewCardCount: 0 })
    expect(result.documents[0].reviewEnabled).toBe(false)
  })
})
