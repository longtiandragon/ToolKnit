import { describe, expect, it } from 'vitest'
import type { Source, SourceAnchor } from '@/types'
import { sourceNoteScaffold, sourceNoteTitle } from './source-note'

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 'source-1', name: 'lecture.md', kind: 'code', mime: 'text/markdown', size: 42,
    importedAt: '2026-08-11T00:00:00.000Z', tags: ['课程'], ...overrides,
  }
}

describe('source note scaffold', () => {
  it('preserves Markdown content exactly while retaining a structured source anchor', () => {
    const content = '---\ntitle: 原样保留\n---\n\n# 第一章\n\n:::unknown\n'
    const anchor: SourceAnchor = { sourceId: 'source-1', pageIndex: 3, bbox: [.1, .2, .4, .3], cropAssetId: 'crop-1' }
    const note = sourceNoteScaffold(source({ content }), anchor)

    expect(note.content).toBe(content)
    expect(note.sourceAnchor).toEqual(anchor)
    expect(note).toMatchObject({ title: 'lecture', folder: '收集箱/资料摘记', subject: '计算机' })
  })

  it('wraps source code in a fence longer than fences already in the file', () => {
    const note = sourceNoteScaffold(source({ name: 'demo.ts', content: 'const sample = "```"\n' }))

    expect(note.content).toContain('````typescript\nconst sample = "```"\n````')
    expect(note.tags).toEqual(['资料摘记', '代码', '课程'])
  })

  it('keeps only a bounded set of source tags', () => {
    const note = sourceNoteScaffold(source({ kind: 'text', name: 'notes.txt', tags: Array.from({ length: 20 }, (_, index) => `标签${index}`), content: '正文' }))

    expect(note.tags).toHaveLength(10)
    expect(note.tags.slice(0, 2)).toEqual(['资料摘记', '文本'])
  })

  it('creates a light PDF scaffold with the selected page and title override', () => {
    const note = sourceNoteScaffold(
      source({ kind: 'pdf', name: 'chapter.pdf', mime: 'application/pdf', content: undefined }),
      { sourceId: 'source-1', pageIndex: 6, bbox: [0, 0, 1, 1] },
      'chapter 2',
    )

    expect(note.title).toBe('chapter 2')
    expect(note.content).toContain('来源：chapter.pdf · 第 7 页')
    expect(note.content).toContain('## 我的理解')
  })

  it('derives a stable title without the final extension', () => {
    expect(sourceNoteTitle(source({ name: '算法.二分.md' }))).toBe('算法.二分')
  })
})
