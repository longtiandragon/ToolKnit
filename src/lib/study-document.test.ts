import { describe, expect, it } from 'vitest'
import { isProxy, reactive } from 'vue'
import type { StudyDocument } from '@/types'
import { cloneStudyDocument, insertStudyDocument, normalizeDocumentFolder } from './study-document'

const document: StudyDocument = {
  id: 'note-1', title: '测试笔记', kind: 'note', subject: '数学', tags: ['公式'], difficulty: 0,
  content: 'x^2 + x_1', createdAt: '2026-08-08', updatedAt: '2026-08-08', reviewEnabled: false, errorTypes: []
}

describe('cloneStudyDocument', () => {
  it('turns nested Vue proxies into a safe plain document', () => {
    const source = reactive(document)
    expect(isProxy(source.tags)).toBe(true)
    const cloned = cloneStudyDocument(source)
    expect(cloned).toEqual(document)
    expect(isProxy(cloned.tags)).toBe(false)
  })

  it('repairs missing legacy array fields', () => {
    const cloned = cloneStudyDocument({ ...document, tags: undefined, errorTypes: undefined } as unknown as StudyDocument)
    expect(cloned.tags).toEqual([])
    expect(cloned.errorTypes).toEqual([])
  })

  it('repairs malformed legacy source and review metadata', () => {
    const cloned = cloneStudyDocument({
      ...document,
      kind: 'question',
      difficulty: Number.NaN,
      reviewEnabled: undefined,
      tags: ['有效', 42],
      sourceAnchor: { sourceId: 'source-1', pageIndex: -4, bbox: [2, -1, Number.NaN, .5] },
      review: { due: '2026-08-08', intervalDays: -1, repetitions: Number.NaN, lapses: -2 }
    } as unknown as StudyDocument)
    expect(cloned).toMatchObject({ difficulty: 3, reviewEnabled: true, questionType: 'general', tags: ['有效'] })
    expect(cloned.sourceAnchor).toMatchObject({ pageIndex: 0, bbox: [1, 0, 0, .5] })
    expect(cloned.review).toMatchObject({ intervalDays: 0, repetitions: 0, lapses: 0 })
    expect(cloned.questionDetails).toEqual({ source: '', stem: '', answer: '', explanation: '', wrongAnswer: '', errorReason: '' })
  })

  it('preserves the full FSRS scheduler snapshot for the next review', () => {
    const cloned = cloneStudyDocument({
      ...document,
      review: {
        due: '2026-08-10T00:00:00.000Z', intervalDays: 3, repetitions: 2, lapses: 0,
        fsrs: { state: 2, stability: 3.1, difficulty: 5.6, elapsedDays: 2, scheduledDays: 3, learningSteps: 0 }
      }
    })
    expect(cloned.review?.fsrs).toEqual({ state: 2, stability: 3.1, difficulty: 5.6, elapsedDays: 2, scheduledDays: 3, learningSteps: 0 })
  })

  it('repairs the independent question error card and derives review enabled state', () => {
    const cloned = cloneStudyDocument({
      ...document,
      kind: 'question',
      reviewEnabled: false,
      reviewFacets: {
        error: { due: '2026-08-12T00:00:00.000Z', intervalDays: -3, repetitions: 1, lapses: 0 },
        unsupported: { due: '2026-08-13T00:00:00.000Z', intervalDays: 1, repetitions: 0, lapses: 0 }
      }
    } as unknown as StudyDocument)
    expect(cloned.reviewEnabled).toBe(true)
    expect(cloned.reviewFacets).toEqual({ error: { due: '2026-08-12T00:00:00.000Z', intervalDays: 0, repetitions: 1, lapses: 0 } })
  })

  it('keeps only string values in structured question fields', () => {
    const cloned = cloneStudyDocument({ ...document, kind: 'question', questionDetails: { stem: '题干', answer: 42, explanation: '解析' } } as unknown as StudyDocument)
    expect(cloned.questionDetails).toEqual({ source: '', stem: '题干', answer: '', explanation: '解析', wrongAnswer: '', errorReason: '' })
  })

  it('keeps only a complete external Markdown link', () => {
    const linked = cloneStudyDocument({ ...document, externalFile: { path: 'F:/notes/math.md', name: 'math.md', hash: 'abc', modifiedAt: '2026-08-09T00:00:00Z', size: 42 } })
    expect(linked.externalFile).toMatchObject({ name: 'math.md', size: 42 })
    const malformed = cloneStudyDocument({ ...document, externalFile: { path: 42 } } as unknown as StudyDocument)
    expect(malformed.externalFile).toBeUndefined()
  })
})

describe('normalizeDocumentFolder', () => {
  it('keeps a portable virtual hierarchy and removes traversal/path-only syntax', () => {
    expect(normalizeDocumentFolder(' 算法\\二分 / ../ 边界:条件 ')).toBe('算法/二分/边界条件')
    expect(normalizeDocumentFolder('../..')).toBeUndefined()
  })
})

describe('insertStudyDocument', () => {
  it('inserts a plain independent entity and refuses duplicate ids', () => {
    const inserted = insertStudyDocument([document], { ...document, id: 'note-2', title: '副本' })
    expect(inserted.map((item) => item.id)).toEqual(['note-2', 'note-1'])
    expect(insertStudyDocument(inserted, { ...document, id: 'note-2', title: '重复' })).toBe(inserted)
  })
})
