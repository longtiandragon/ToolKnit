import type { ContentRecent, ContentFavoriteKind, Source, StudyDocument, VocabularyEntry } from '@/types'
import { resolveFavoriteContent, type VisualContentSummary } from '@/lib/content-favorites'

export const CONTENT_RECENT_LIMIT = 128

export function contentRecentKey(item: Pick<ContentRecent, 'itemId' | 'itemKind'>) {
  return `${item.itemKind}:${item.itemId}`
}

export function upsertContentRecent(current: ContentRecent[], recent: ContentRecent) {
  const key = contentRecentKey(recent)
  return [recent, ...current.filter((item) => contentRecentKey(item) !== key)]
    .sort((left, right) => right.openedAt.localeCompare(left.openedAt))
    .slice(0, CONTENT_RECENT_LIMIT)
}

export function removeContentRecent(current: ContentRecent[], itemKind: ContentFavoriteKind, itemId: string) {
  const key = `${itemKind}:${itemId}`
  return current.filter((item) => contentRecentKey(item) !== key)
}

/** Resolve only metadata already available to lists. Reuse the favorite
 * resolver so recents and favorites cannot disagree about titles or routes. */
export function resolveRecentContent(
  recents: ContentRecent[],
  documents: StudyDocument[],
  vocabulary: VocabularyEntry[],
  sources: Source[],
  limit = 8,
  visualProjects: VisualContentSummary[] = [],
) {
  return resolveFavoriteContent(
    recents.map((item) => ({ itemId: item.itemId, itemKind: item.itemKind, addedAt: item.openedAt })),
    documents,
    vocabulary,
    sources,
    limit,
    visualProjects,
  ).map(({ addedAt, ...item }) => ({ ...item, openedAt: addedAt }))
}
