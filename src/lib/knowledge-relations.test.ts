import { describe, expect, it } from 'vitest'
import type { EntityRelation } from '@/types'
import { buildKnowledgeRelationGraph, knowledgeRelationEdgesFor, resolveBrowserWikiLinks, searchKnowledgeRelationNodes } from './knowledge-relations'

describe('knowledge relation projection', () => {
  const relations: EntityRelation[] = [
    { fromId: 'note-1', toId: 'word-1', relationType: 'related', createdAt: '2026-08-12T09:00:00Z' },
    { fromId: 'note-1', toId: 'diagram-1', relationType: 'prerequisite', createdAt: '2026-08-12T10:00:00Z' },
    { fromId: 'missing', toId: 'note-1', relationType: 'variation', createdAt: '2026-08-12T11:00:00Z' },
  ]

  const graph = buildKnowledgeRelationGraph(
    [{ id: 'note-1', title: '二分查找', kind: 'note', subject: '算法', updatedAt: '2026-08-12T08:00:00Z' }],
    [{ id: 'word-1', lemma: 'boundary', language: '英语', updatedAt: '2026-08-11T08:00:00Z' }],
    [{ id: 'diagram-1', title: '边界流程', imageCount: 1, annotationCount: 3, updatedAt: '2026-08-10T08:00:00Z' }],
    relations,
  )

  it('resolves metadata without carrying content payloads and counts direction', () => {
    expect(graph.nodes.map(node => [node.id, node.degree, node.inbound, node.outbound])).toEqual([
      ['note-1', 2, 0, 2],
      ['word-1', 1, 1, 0],
      ['diagram-1', 1, 1, 0],
    ])
    expect(graph.edges).toHaveLength(2)
    expect(graph.unresolvedEdges).toBe(1)
    expect(knowledgeRelationEdgesFor(graph, 'word-1')).toHaveLength(1)
  })

  it('searches only bounded node metadata', () => {
    expect(searchKnowledgeRelationNodes(graph.nodes, '算法').map(node => node.id)).toEqual(['note-1'])
    expect(searchKnowledgeRelationNodes(graph.nodes, '边界', 1).map(node => node.id)).toEqual(['diagram-1'])
  })

  it('merges a Markdown double link with an explicit edge instead of double-counting it', () => {
    const graphWithWiki = buildKnowledgeRelationGraph(
      [
        { id: 'note-1', title: '二分查找', kind: 'note', subject: '算法', updatedAt: '2026-08-12T08:00:00Z' },
        { id: 'note-2', title: '循环不变量', kind: 'note', subject: '算法', updatedAt: '2026-08-12T07:00:00Z' },
      ],
      [],
      [],
      [{ fromId: 'note-1', toId: 'note-2', relationType: 'prerequisite', createdAt: '2026-08-12T09:00:00Z' }],
      [{ fromId: 'note-1', toId: 'note-2', targetTitle: '循环不变量', headings: ['定义'], occurrences: 2, sourceUpdatedAt: '2026-08-12T08:00:00Z' }],
    )
    expect(graphWithWiki.edges).toHaveLength(1)
    expect(graphWithWiki.edges[0]).toMatchObject({ explicit: true, wiki: { occurrences: 2 } })
    expect(graphWithWiki.nodes.map(node => node.degree)).toEqual([1, 1])
  })

  it('resolves browser wiki links exactly and reports missing or ambiguous targets', () => {
    const projection = resolveBrowserWikiLinks([
      { id: 'a', title: '起点', kind: 'note', subject: '算法', updatedAt: '2026-08-12T08:00:00Z', content: '[[目标#定义]] [[目标|别名]] [[缺失]] [[重复]]' },
      { id: 'b', title: '目标', kind: 'note', subject: '算法', updatedAt: '2026-08-11T08:00:00Z', content: '' },
      { id: 'c', title: '重复', kind: 'note', subject: '', updatedAt: '2026-08-10T08:00:00Z', content: '' },
      { id: 'd', title: '重复', kind: 'question', subject: '', updatedAt: '2026-08-09T08:00:00Z', content: '' },
    ])
    expect(projection.links).toEqual([expect.objectContaining({ fromId: 'a', toId: 'b', occurrences: 2, headings: ['定义'] })])
    expect(projection.unresolvedCount).toBe(1)
    expect(projection.ambiguousCount).toBe(1)
  })
})
