import type { EntityRelation, StudyDocument, VocabularyEntry } from '@/types'
import type { RelationEntityKind, VisualRelationTarget } from '@/lib/relation-targets'
import { normalizeWikiTitle, parseWikiLinks } from '@/lib/wiki-links'

export type KnowledgeRelationNode = {
  id: string
  title: string
  kind: RelationEntityKind
  subtitle: string
  updatedAt: string
  degree: number
  inbound: number
  outbound: number
}

export type KnowledgeRelationEdge = {
  key: string
  relation: EntityRelation
  from: KnowledgeRelationNode
  to: KnowledgeRelationNode
  explicit: boolean
  wiki?: KnowledgeWikiLink
}

export type KnowledgeWikiLink = {
  fromId: string
  toId: string
  targetTitle: string
  headings: string[]
  occurrences: number
  sourceUpdatedAt: string
}

export type KnowledgeWikiLinkProjection = {
  links: KnowledgeWikiLink[]
  unresolvedCount: number
  ambiguousCount: number
  truncated: boolean
}

export type KnowledgeRelationGraph = {
  nodes: KnowledgeRelationNode[]
  edges: KnowledgeRelationEdge[]
  unresolvedEdges: number
}

type DocumentSummary = Pick<StudyDocument, 'id' | 'title' | 'kind' | 'subject' | 'updatedAt'>
type BrowserDocumentSummary = DocumentSummary & Pick<StudyDocument, 'content'>
type VocabularySummary = Pick<VocabularyEntry, 'id' | 'lemma' | 'language' | 'updatedAt'>

/** Builds a deterministic, metadata-only graph. Markdown bodies, vocabulary
 * senses and visual annotation payloads never enter this projection. */
export function buildKnowledgeRelationGraph(
  documents: readonly DocumentSummary[],
  vocabulary: readonly VocabularySummary[],
  visuals: readonly VisualRelationTarget[],
  relations: readonly EntityRelation[],
  wikiLinks: readonly KnowledgeWikiLink[] = [],
): KnowledgeRelationGraph {
  const byId = new Map<string, KnowledgeRelationNode>()
  for (const item of documents) byId.set(item.id, {
    id: item.id,
    title: item.title,
    kind: item.kind,
    subtitle: item.subject || '未分类',
    updatedAt: item.updatedAt,
    degree: 0,
    inbound: 0,
    outbound: 0,
  })
  for (const item of vocabulary) byId.set(item.id, {
    id: item.id,
    title: item.lemma,
    kind: 'word',
    subtitle: item.language,
    updatedAt: item.updatedAt,
    degree: 0,
    inbound: 0,
    outbound: 0,
  })
  for (const item of visuals) byId.set(item.id, {
    id: item.id,
    title: item.title,
    kind: 'diagram',
    subtitle: `${item.imageCount} 张源图 · ${item.annotationCount} 个标注`,
    updatedAt: item.updatedAt,
    degree: 0,
    inbound: 0,
    outbound: 0,
  })

  const edges: KnowledgeRelationEdge[] = []
  let unresolvedEdges = 0
  for (const relation of relations) {
    const from = byId.get(relation.fromId)
    const to = byId.get(relation.toId)
    if (!from || !to) { unresolvedEdges += 1; continue }
    from.degree += 1
    from.outbound += 1
    to.degree += 1
    to.inbound += 1
    edges.push({
      key: `${relation.fromId}:${relation.toId}:${relation.relationType}`,
      relation,
      from,
      to,
      explicit: true,
    })
  }

  for (const wiki of wikiLinks) {
    const from = byId.get(wiki.fromId)
    const to = byId.get(wiki.toId)
    if (!from || !to) { unresolvedEdges += 1; continue }
    const existing = edges.find(edge => edge.from.id === wiki.fromId && edge.to.id === wiki.toId)
    if (existing) {
      existing.wiki = wiki
      continue
    }
    from.degree += 1
    from.outbound += 1
    to.degree += 1
    to.inbound += 1
    edges.push({
      key: `wiki:${wiki.fromId}:${wiki.toId}`,
      relation: { fromId: wiki.fromId, toId: wiki.toId, relationType: 'related', createdAt: wiki.sourceUpdatedAt },
      from,
      to,
      explicit: false,
      wiki,
    })
  }

  const nodes = [...byId.values()].sort((left, right) => (
    right.degree - left.degree
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.title.localeCompare(right.title, 'zh-CN')
  ))
  edges.sort((left, right) => right.relation.createdAt.localeCompare(left.relation.createdAt) || left.key.localeCompare(right.key))
  return { nodes, edges, unresolvedEdges }
}

/** Browser/demo fallback only. Desktop uses SQLite's save-time projection and
 * never scans hydrated Markdown bodies on the renderer thread. */
export function resolveBrowserWikiLinks(documents: readonly BrowserDocumentSummary[], limit = 1_000): KnowledgeWikiLinkProjection {
  const targets = new Map<string, BrowserDocumentSummary[]>()
  for (const document of documents) {
    const key = normalizeWikiTitle(document.title)
    targets.set(key, [...(targets.get(key) ?? []), document])
  }
  const links: KnowledgeWikiLink[] = []
  const byPair = new Map<string, KnowledgeWikiLink>()
  let unresolvedCount = 0
  let ambiguousCount = 0
  let truncated = false
  for (const source of documents) {
    for (const parsed of parseWikiLinks(source.content)) {
      const matches = targets.get(normalizeWikiTitle(parsed.target)) ?? []
      if (!matches.length) { unresolvedCount += 1; continue }
      if (matches.length !== 1) { ambiguousCount += 1; continue }
      const target = matches[0]!
      if (target.id === source.id) continue
      const pair = `${source.id}:${target.id}`
      const existing = byPair.get(pair)
      if (existing) {
        existing.occurrences += 1
        if (parsed.heading && existing.headings.length < 8 && !existing.headings.includes(parsed.heading)) existing.headings.push(parsed.heading)
        continue
      }
      if (links.length >= Math.max(1, Math.trunc(limit))) { truncated = true; break }
      const link: KnowledgeWikiLink = {
        fromId: source.id,
        toId: target.id,
        targetTitle: parsed.target,
        headings: parsed.heading ? [parsed.heading] : [],
        occurrences: 1,
        sourceUpdatedAt: source.updatedAt,
      }
      byPair.set(pair, link)
      links.push(link)
    }
    if (truncated) break
  }
  return { links, unresolvedCount, ambiguousCount, truncated }
}

export function knowledgeRelationEdgesFor(graph: KnowledgeRelationGraph, nodeId: string, limit = 60) {
  return graph.edges
    .filter(edge => edge.from.id === nodeId || edge.to.id === nodeId)
    .slice(0, Math.max(1, Math.trunc(limit)))
}

export function searchKnowledgeRelationNodes(nodes: readonly KnowledgeRelationNode[], query: string, limit = 80) {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  const matches = needle
    ? nodes.filter(node => `${node.title} ${node.subtitle}`.toLocaleLowerCase('zh-CN').includes(needle))
    : nodes
  return matches.slice(0, Math.max(1, Math.trunc(limit)))
}
