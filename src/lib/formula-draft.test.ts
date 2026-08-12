import { describe, expect, it } from 'vitest'
import { formulaDraftScaffold } from './formula-draft'
import type { Source, SourceAnchor } from '@/types'

const source: Source = {
  id: 'source-1', name: '线性代数扫描题.png', kind: 'image', mime: 'image/png', size: 2048,
  importedAt: '2026-08-10T00:00:00.000Z', tags: [],
}

describe('formula draft scaffold', () => {
  it('keeps a whole-source anchor and an explicit-send boundary', () => {
    const draft = formulaDraftScaffold(source)
    expect(draft.title).toBe('公式草稿 · 线性代数扫描题')
    expect(draft.sourceAnchor).toEqual({ sourceId: 'source-1', pageIndex: 0, bbox: [0, 0, 1, 1] })
    expect(draft.content).toContain('只有在你明确确认后才会发送')
    expect(draft.tags).toEqual(['公式', '待整理'])
  })

  it('preserves the selected page, region and crop', () => {
    const anchor: SourceAnchor = { sourceId: source.id, pageIndex: 3, bbox: [.1, .2, .5, .35], cropAssetId: 'crop-1' }
    expect(formulaDraftScaffold(source, anchor).sourceAnchor).toEqual(anchor)
  })
})
