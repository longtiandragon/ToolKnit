import { describe, expect, it } from 'vitest'
import type { StudyDocument } from '@/types'
import { createIndependentDocumentCopy } from './document-copy'

const source: StudyDocument = {
  id: 'source-1', title: '二分模板', kind: 'question', subject: '算法', tags: ['二分'], folder: '算法/模板', difficulty: 3,
  content: '# 二分模板\r\n\r\n## 边界\r\n\r\n保持不变量。',
  createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z', reviewEnabled: true, errorTypes: ['边界'],
  questionDetails: { source: '课程讲义', stem: '题干', answer: '答案', explanation: '解析', wrongAnswer: '错误答案', errorReason: '遗漏边界' },
  review: { due: '2026-08-10T00:00:00.000Z', intervalDays: 2, repetitions: 1, lapses: 0 },
  externalFile: { path: 'F:/notes/binary-search.md', name: 'binary-search.md', hash: 'hash', modifiedAt: '2026-08-08T00:00:00.000Z', size: 120 }
}

describe('createIndependentDocumentCopy', () => {
  it('keeps content and learning metadata but starts independent from disk and FSRS', () => {
    const copy = createIndependentDocumentCopy(source, 'copy-1', '2026-08-09T00:00:00.000Z')

    expect(copy).toMatchObject({
      id: 'copy-1', title: '二分模板 副本', folder: '算法/模板', kind: 'question', reviewEnabled: false,
      content: '# 二分模板 副本\r\n\r\n## 边界\r\n\r\n保持不变量。',
      createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z'
    })
    expect(copy.review).toBeUndefined()
    expect(copy.externalFile).toBeUndefined()
    expect(source.title).toBe('二分模板')
    expect(source.externalFile?.path).toBe('F:/notes/binary-search.md')
    expect(source.reviewEnabled).toBe(true)
  })

  it('does not alter body text when the source has no matching top-level title', () => {
    const copy = createIndependentDocumentCopy({ ...source, title: '原笔记', content: '没有标题\n正文' }, 'copy-2', '2026-08-09T00:00:00.000Z')
    expect(copy.content).toBe('没有标题\n正文')
  })
})
