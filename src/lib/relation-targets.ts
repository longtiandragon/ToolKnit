import type { StudyDocument, VocabularyEntry } from '@/types'

export type RelationEntityKind = StudyDocument['kind'] | 'word' | 'diagram'

export interface RelationTargetSummary {
  id: string
  title: string
  kind: RelationEntityKind
  subtitle: string
  updatedAt: string
}

export interface IndexedRelationTarget {
  id: string
  title: string
  kind: StudyDocument['kind'] | 'word'
  subject: string
  updatedAt: string
}

export interface VisualRelationTarget {
  id: string
  title: string
  imageCount: number
  annotationCount: number
  updatedAt: string
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase('zh-CN')
}

function matchRank(title: string, query: string) {
  const candidate = normalized(title)
  if (candidate === query) return 0
  if (candidate.startsWith(query)) return 1
  return candidate.includes(query) ? 2 : 3
}

export function relationKindLabel(kind: RelationEntityKind) {
  if (kind === 'word') return '单词'
  if (kind === 'question') return '错题'
  if (kind === 'diagram') return '画布'
  return '笔记'
}

/** Merge SQLite FTS results with visual-project metadata. Source images and
 * annotation payloads never enter the relationship inspector. */
export function mergeRelationTargets(
  indexed: IndexedRelationTarget[],
  visuals: VisualRelationTarget[],
  query: string,
  excludedId = '',
  limit = 16,
) {
  const needle = normalized(query)
  if (!needle) return [] as RelationTargetSummary[]
  const candidates: Array<RelationTargetSummary & { rank: number; order: number }> = indexed
    .filter(item => item.id !== excludedId)
    .map((item, order) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      subtitle: item.subject || '未分类',
      updatedAt: item.updatedAt,
      rank: matchRank(item.title, needle),
      order,
    }))
  const offset = candidates.length
  for (const [index, item] of visuals.entries()) {
    if (item.id === excludedId || matchRank(item.title, needle) === 3) continue
    candidates.push({
      id: item.id,
      title: item.title,
      kind: 'diagram',
      subtitle: `${item.imageCount} 张源图 · ${item.annotationCount} 个标注`,
      updatedAt: item.updatedAt,
      rank: matchRank(item.title, needle),
      order: offset + index,
    })
  }
  return candidates
    .sort((left, right) => left.rank - right.rank || left.order - right.order)
    .slice(0, Math.max(1, limit))
    .map(({ rank: _rank, order: _order, ...item }) => item)
}

export function resolveRelationTarget(
  id: string,
  documents: Pick<StudyDocument, 'id' | 'title' | 'kind' | 'subject'>[],
  vocabulary: Pick<VocabularyEntry, 'id' | 'lemma' | 'language'>[],
  visuals: VisualRelationTarget[],
) {
  const document = documents.find(item => item.id === id)
  if (document) return { id: document.id, title: document.title, kind: document.kind, subtitle: document.subject || '未分类' } satisfies Omit<RelationTargetSummary, 'updatedAt'>
  const word = vocabulary.find(item => item.id === id)
  if (word) return { id: word.id, title: word.lemma, kind: 'word', subtitle: word.language } satisfies Omit<RelationTargetSummary, 'updatedAt'>
  const visual = visuals.find(item => item.id === id)
  if (visual) return { id: visual.id, title: visual.title, kind: 'diagram', subtitle: `${visual.imageCount} 张源图 · ${visual.annotationCount} 个标注` } satisfies Omit<RelationTargetSummary, 'updatedAt'>
  return undefined
}

export function removeEntityRelations<T extends { fromId: string; toId: string }>(relations: T[], id: string) {
  return relations.filter(relation => relation.fromId !== id && relation.toId !== id)
}
