import { describe, expect, it } from 'vitest'
import type { Source } from '@/types'
import { filterSources, normalizeSourceTags, sourceFilterFromQuery, sourcePageFromQuery, sourceSearchFromQuery, sourceTagsFromInput } from './source-list'

const sources: Source[] = [
  { id: 'pdf', name: '图论讲义.pdf', kind: 'pdf', mime: 'application/pdf', size: 1200, importedAt: '2026-01-01', tags: ['算法', '图论'] },
  { id: 'code', name: 'dijkstra.cpp', kind: 'code', mime: 'text/x-c++src', size: 800, importedAt: '2026-01-02', tags: ['最短路'] },
  { id: 'image', name: '笔记照片.png', kind: 'image', mime: 'image/png', size: 900, importedAt: '2026-01-03', tags: ['课堂'] },
]

describe('filterSources', () => {
  it('filters metadata by kind without changing its original order', () => {
    expect(filterSources(sources, 'code', '').map((source) => source.id)).toEqual(['code'])
  })

  it('finds names, MIME metadata and tags without opening file payloads', () => {
    expect(filterSources(sources, 'all', '最短路').map((source) => source.id)).toEqual(['code'])
    expect(filterSources(sources, 'all', 'PDF').map((source) => source.id)).toEqual(['pdf'])
  })

  it('normalizes comma-separated tags without keeping duplicates or blanks', () => {
    expect(sourceTagsFromInput(' 算法，图论, 算法 ,  ')).toEqual(['算法', '图论'])
    expect(normalizeSourceTags(['PDF', 'pdf', '课程资料'])).toEqual(['PDF', '课程资料'])
  })

  it('normalizes deep-link state without accepting invalid filters or pages', () => {
    expect(sourceFilterFromQuery('pdf')).toBe('pdf')
    expect(sourceFilterFromQuery('video')).toBe('all')
    expect(sourceFilterFromQuery(['code', 'pdf'])).toBe('code')
    expect(sourcePageFromQuery('7.9')).toBe(7)
    expect(sourcePageFromQuery('-3')).toBe(0)
    expect(sourcePageFromQuery('not-a-page')).toBe(0)
    expect(sourceSearchFromQuery(['图论', 'ignored'])).toBe('图论')
  })
})
