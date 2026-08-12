import { describe, expect, it } from 'vitest'
import { searchGlobalClipboard, searchGlobalSources } from './global-local-search'
import type { ClipboardItem, Source } from '@/types'

const source = (patch: Partial<Source> = {}): Source => ({
  id: 'source-1', name: '线性代数讲义.pdf', kind: 'pdf', mime: 'application/pdf', size: 120,
  importedAt: '2026-08-10T08:00:00.000Z', tags: ['数学', '矩阵'], ...patch,
})

const clipboard = (patch: Partial<ClipboardItem> = {}): ClipboardItem => ({
  id: 'clip-1', kind: 'code', content: 'const binarySearch = () => true', hash: 'hash',
  capturedAt: '2026-08-10T08:00:00.000Z', ...patch,
})

describe('global local search summaries', () => {
  it('searches source metadata without reading source bodies', () => {
    expect(searchGlobalSources([source()], '矩阵')).toEqual([
      expect.objectContaining({ id: 'source-1', title: '线性代数讲义.pdf', kind: 'pdf', detail: expect.stringContaining('数学') }),
    ])
    expect(searchGlobalSources([source()], '讲')).toEqual([])
  })

  it('searches only the bounded hydrated clipboard preview', () => {
    expect(searchGlobalClipboard([clipboard({ pinned: true })], 'binary')).toEqual([
      expect.objectContaining({ id: 'clip-1', kind: 'code', pinned: true, title: expect.stringContaining('binarySearch') }),
    ])
    expect(searchGlobalClipboard([clipboard()], 'b')).toEqual([])
  })

  it('bounds visible results independently of collection size', () => {
    const items = Array.from({ length: 20 }, (_, index) => clipboard({ id: `clip-${index}`, content: `shared token ${index}` }))
    expect(searchGlobalClipboard(items, 'shared', 4)).toHaveLength(4)
  })
})
