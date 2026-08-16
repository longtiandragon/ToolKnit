import type { ContentFavorite, ContentFavoriteKind, Source, StudyDocument, VocabularyEntry } from '@/types'
import { vocabularySenseCount } from './vocabulary'

export interface FavoriteContentItem extends ContentFavorite {
  title: string
  detail: string
  updatedAt: string
}

/** Lightweight metadata for a visual project. Source images and annotation
 * payloads must never be loaded just to render a global list. */
export interface VisualContentSummary {
  id: string
  title: string
  imageCount: number
  annotationCount: number
  updatedAt: string
}

export function contentFavoriteKey(item: Pick<ContentFavorite, 'itemId' | 'itemKind'>) {
  return `${item.itemKind}:${item.itemId}`
}

export function upsertContentFavorite(current: ContentFavorite[], favorite: ContentFavorite) {
  const key = contentFavoriteKey(favorite)
  return [favorite, ...current.filter((item) => contentFavoriteKey(item) !== key)]
    .sort((left, right) => right.addedAt.localeCompare(left.addedAt))
}

export function removeContentFavorite(current: ContentFavorite[], itemKind: ContentFavoriteKind, itemId: string) {
  const key = `${itemKind}:${itemId}`
  return current.filter((item) => contentFavoriteKey(item) !== key)
}

/** Resolve only bounded metadata already present in Pinia. Markdown bodies,
 * source previews, and binary files are deliberately never touched here. */
export function resolveFavoriteContent(
  favorites: ContentFavorite[],
  documents: StudyDocument[],
  vocabulary: VocabularyEntry[],
  sources: Source[],
  limit = 8,
  visualProjects: VisualContentSummary[] = [],
): FavoriteContentItem[] {
  const documentMap = new Map(documents.map((item) => [item.id, item]))
  const vocabularyMap = new Map(vocabulary.map((item) => [item.id, item]))
  const sourceMap = new Map(sources.map((item) => [item.id, item]))
  const visualProjectMap = new Map(visualProjects.map((item) => [item.id, item]))
  return favorites
    .slice()
    .sort((left, right) => right.addedAt.localeCompare(left.addedAt))
    .flatMap((favorite) => {
      if (favorite.itemKind === 'word') {
        const entry = vocabularyMap.get(favorite.itemId)
        return entry ? [{ ...favorite, title: entry.lemma, detail: `${entry.language} · ${vocabularySenseCount(entry)} 个义项`, updatedAt: entry.updatedAt }] : []
      }
      if (favorite.itemKind === 'source') {
        const source = sourceMap.get(favorite.itemId)
        return source ? [{ ...favorite, title: source.name, detail: `${source.kind.toUpperCase()} · ${source.tags.slice(0, 2).join(' · ') || '未加标签'}`, updatedAt: source.lastOpenedAt || source.importedAt }] : []
      }
      if (favorite.itemKind === 'diagram') {
        const project = visualProjectMap.get(favorite.itemId)
        return project ? [{ ...favorite, title: project.title, detail: `${project.imageCount} 张源图 · ${project.annotationCount} 个标注`, updatedAt: project.updatedAt }] : []
      }
      const document = documentMap.get(favorite.itemId)
      if (!document || document.kind !== favorite.itemKind) return []
      return [{
        ...favorite,
        title: document.title,
        detail: document.kind === 'note' ? `${document.folder || document.subject || '未分类'} · Markdown` : `${document.subject || '未分类'} · 难度 ${document.difficulty}`,
        updatedAt: document.updatedAt,
      }]
    })
    .slice(0, Math.max(0, Math.trunc(limit)))
}

export function favoriteContentRoute(item: Pick<ContentFavorite, 'itemId' | 'itemKind'>) {
  if (item.itemKind === 'word') return { path: '/words', query: { word: item.itemId } }
  if (item.itemKind === 'source') return { path: '/library', query: { source: item.itemId } }
  if (item.itemKind === 'diagram') return { path: '/visual', query: { project: item.itemId } }
  return { path: '/documents', query: { kind: item.itemKind, document: item.itemId } }
}

export const favoriteContentLabels: Record<ContentFavoriteKind, string> = {
  note: '笔记', question: '题目', word: '单词', source: '资料', diagram: '画布',
}

export const favoriteContentIcons: Record<ContentFavoriteKind, string> = {
  note: 'book', question: 'review', word: 'sort', source: 'inbox', diagram: 'palette',
}
