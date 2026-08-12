import { describe, expect, it } from 'vitest'
import type { ContentRecent, Source, StudyDocument, VocabularyEntry } from '@/types'
import { CONTENT_RECENT_LIMIT, removeContentRecent, resolveRecentContent, upsertContentRecent } from './content-recents'

const document = (id: string, kind: 'note' | 'question'): StudyDocument => ({
  id, kind, title: `${kind}-${id}`, subject: '算法', tags: [], difficulty: 2, content: '', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z', reviewEnabled: false, errorTypes: [],
})

describe('content recents', () => {
  it('moves a reopened item to the front without duplicating it', () => {
    const first: ContentRecent = { itemId: 'a', itemKind: 'note', openedAt: '2026-08-01T00:00:00Z' }
    const updated = upsertContentRecent([first, { itemId: 'b', itemKind: 'word', openedAt: '2026-08-02T00:00:00Z' }], { ...first, openedAt: '2026-08-03T00:00:00Z' })
    expect(updated.map((item) => `${item.itemKind}:${item.itemId}`)).toEqual(['note:a', 'word:b'])
    expect(removeContentRecent(updated, 'note', 'a')).toHaveLength(1)
  })

  it('stays bounded under a long desktop session', () => {
    const recents = Array.from({ length: CONTENT_RECENT_LIMIT + 20 }, (_, index) => ({ itemId: `doc-${index}`, itemKind: 'note' as const, openedAt: new Date(1_700_000_000_000 + index).toISOString() }))
      .reduce<ContentRecent[]>((current, item) => upsertContentRecent(current, item), [])
    expect(recents).toHaveLength(CONTENT_RECENT_LIMIT)
    expect(recents[0]?.itemId).toBe(`doc-${CONTENT_RECENT_LIMIT + 19}`)
  })

  it('resolves metadata in access order and ignores stale pointers', () => {
    const recents: ContentRecent[] = [
      { itemId: 'missing', itemKind: 'source', openedAt: '2026-08-05T00:00:00Z' },
      { itemId: 'word', itemKind: 'word', openedAt: '2026-08-04T00:00:00Z' },
      { itemId: 'question', itemKind: 'question', openedAt: '2026-08-03T00:00:00Z' },
      { itemId: 'source', itemKind: 'source', openedAt: '2026-08-02T00:00:00Z' },
    ]
    const word: VocabularyEntry = { id: 'word', lemma: 'run', language: 'en', forms: {}, senses: [], createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z' }
    const source: Source = { id: 'source', name: 'paper.pdf', kind: 'pdf', mime: 'application/pdf', size: 10, importedAt: '2026-08-01T00:00:00Z', tags: [] }
    expect(resolveRecentContent(recents, [document('question', 'question')], [word], [source], 2).map((item) => item.itemId)).toEqual(['word', 'question'])
  })

  it('resolves a recent visual project from its bounded summary', () => {
    const recent: ContentRecent = { itemId: 'diagram', itemKind: 'diagram', openedAt: '2026-08-05T00:00:00Z' }
    const resolved = resolveRecentContent([recent], [], [], [], 8, [{ id: 'diagram', title: '流程画布', imageCount: 1, annotationCount: 4, updatedAt: '2026-08-04T00:00:00Z' }])
    expect(resolved[0]).toMatchObject({ itemId: 'diagram', itemKind: 'diagram', title: '流程画布', openedAt: recent.openedAt })
  })
})
