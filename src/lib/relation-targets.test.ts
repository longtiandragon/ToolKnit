import { describe, expect, it } from 'vitest'
import { mergeRelationTargets, relationKindLabel, removeEntityRelations, resolveRelationTarget } from './relation-targets'

describe('relation targets', () => {
  it('merges visual summaries with indexed entities without carrying image payloads', () => {
    const results = mergeRelationTargets(
      [{ id: 'note', title: '算法笔记', kind: 'note', subject: '数据结构', updatedAt: '2026-08-01T00:00:00Z' }],
      [{ id: 'diagram', title: '算法画布', imageCount: 3, annotationCount: 8, updatedAt: '2026-08-02T00:00:00Z' }],
      '算法',
    )
    expect(results).toEqual([
      { id: 'note', title: '算法笔记', kind: 'note', subtitle: '数据结构', updatedAt: '2026-08-01T00:00:00Z' },
      { id: 'diagram', title: '算法画布', kind: 'diagram', subtitle: '3 张源图 · 8 个标注', updatedAt: '2026-08-02T00:00:00Z' },
    ])
    expect(results[1]).not.toHaveProperty('images')
  })

  it('resolves a stored diagram relation from its lightweight catalog', () => {
    expect(resolveRelationTarget('diagram', [], [], [{ id: 'diagram', title: '复盘草图', imageCount: 1, annotationCount: 2, updatedAt: '' }])).toEqual({
      id: 'diagram', title: '复盘草图', kind: 'diagram', subtitle: '1 张源图 · 2 个标注',
    })
    expect(relationKindLabel('diagram')).toBe('画布')
  })

  it('removes both inbound and outbound edges after a native entity deletion', () => {
    const relations = [
      { fromId: 'note', toId: 'diagram', relationType: 'related' },
      { fromId: 'diagram', toId: 'word', relationType: 'variation' },
      { fromId: 'note', toId: 'word', relationType: 'related' },
    ]
    expect(removeEntityRelations(relations, 'diagram')).toEqual([relations[2]])
  })
})
