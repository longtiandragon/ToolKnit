import { describe, expect, it } from 'vitest'
import { favoriteContentRoute, removeContentFavorite, resolveFavoriteContent, upsertContentFavorite } from './content-favorites'
import type { ContentFavorite, Source, StudyDocument, VocabularyEntry } from '@/types'
import type { VisualContentSummary } from './content-favorites'

const document = (id: string, kind: 'note' | 'question'): StudyDocument => ({
  id, kind, title: `${kind}-${id}`, subject: '算法', tags: [], difficulty: 2, content: '', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z', reviewEnabled: false, errorTypes: [],
})

describe('content favorites', () => {
  it('upserts one stable key and removes it without disturbing siblings', () => {
    const first: ContentFavorite = { itemId: 'a', itemKind: 'note', addedAt: '2026-08-01T00:00:00Z' }
    const updated = upsertContentFavorite([first, { itemId: 'b', itemKind: 'word', addedAt: '2026-08-02T00:00:00Z' }], { ...first, addedAt: '2026-08-03T00:00:00Z' })
    expect(updated.map((item) => `${item.itemKind}:${item.itemId}`)).toEqual(['note:a', 'word:b'])
    expect(removeContentFavorite(updated, 'note', 'a')).toHaveLength(1)
  })

  it('resolves bounded metadata in favorite order and ignores stale pointers', () => {
    const favorites: ContentFavorite[] = [
      { itemId: 'missing', itemKind: 'source', addedAt: '2026-08-05T00:00:00Z' },
      { itemId: 'word', itemKind: 'word', addedAt: '2026-08-04T00:00:00Z' },
      { itemId: 'question', itemKind: 'question', addedAt: '2026-08-03T00:00:00Z' },
      { itemId: 'source', itemKind: 'source', addedAt: '2026-08-02T00:00:00Z' },
    ]
    const word: VocabularyEntry = { id: 'word', lemma: 'run', language: 'en', forms: {}, senses: [], createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z' }
    const source: Source = { id: 'source', name: 'paper.pdf', kind: 'pdf', mime: 'application/pdf', size: 10, importedAt: '2026-08-01T00:00:00Z', tags: [] }
    expect(resolveFavoriteContent(favorites, [document('question', 'question')], [word], [source], 2).map((item) => item.itemId)).toEqual(['word', 'question'])
  })

  it('builds routes for every supported content family', () => {
    expect(favoriteContentRoute({ itemId: 'n', itemKind: 'note' })).toEqual({ path: '/documents', query: { kind: 'note', document: 'n' } })
    expect(favoriteContentRoute({ itemId: 'w', itemKind: 'word' }).path).toBe('/words')
    expect(favoriteContentRoute({ itemId: 's', itemKind: 'source' }).path).toBe('/library')
    expect(favoriteContentRoute({ itemId: 'd', itemKind: 'diagram' })).toEqual({ path: '/visual', query: { project: 'd' } })
  })

  it('resolves visual projects from summaries without loading source images', () => {
    const project: VisualContentSummary = { id: 'diagram', title: '算法长图', imageCount: 3, annotationCount: 8, updatedAt: '2026-08-05T00:00:00Z' }
    const favorite: ContentFavorite = { itemId: project.id, itemKind: 'diagram', addedAt: '2026-08-06T00:00:00Z' }
    expect(resolveFavoriteContent([favorite], [], [], [], 8, [project])).toEqual([{ ...favorite, title: '算法长图', detail: '3 张源图 · 8 个标注', updatedAt: project.updatedAt }])
  })
})
