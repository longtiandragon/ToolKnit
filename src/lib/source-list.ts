import type { Source, SourceKind } from '@/types'

export type SourceFilter = 'all' | SourceKind

const sourceFilters = new Set<SourceFilter>(['all', 'image', 'pdf', 'code', 'text'])

export const SOURCE_TAG_LIMIT = 64
export const SOURCE_TAG_MAX_LENGTH = 120

/** Keep source tags small and deterministic before they cross the native boundary. */
export function normalizeSourceTags(tags: string[]) {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const rawTag of tags) {
    const tag = rawTag.trim()
    if (!tag || tag.length > SOURCE_TAG_MAX_LENGTH) continue
    const key = tag.toLocaleLowerCase('zh-CN')
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(tag)
    if (normalized.length >= SOURCE_TAG_LIMIT) break
  }
  return normalized
}

export function sourceTagsFromInput(value: string) {
  return normalizeSourceTags(value.split(/[,，]/))
}

/** Normalize hash-query values before they become library UI state. */
export function sourceFilterFromQuery(value: unknown): SourceFilter {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && sourceFilters.has(candidate as SourceFilter)
    ? candidate as SourceFilter
    : 'all'
}

export function sourceSearchFromQuery(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' ? candidate.slice(0, 160) : ''
}

export function sourcePageFromQuery(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value
  const page = typeof candidate === 'number' || typeof candidate === 'string' ? Number(candidate) : 0
  return Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0
}

/**
 * Filters only the small metadata stored in the library index.  The selected
 * file body remains on disk until it is opened, so searching a large library
 * never wakes PDF/image payloads or source-code strings.
 */
export function filterSources(sources: Source[], filter: SourceFilter, query: string) {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  return sources.filter((source) => {
    if (filter !== 'all' && source.kind !== filter) return false
    if (!needle) return true
    return `${source.name} ${source.mime} ${source.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(needle)
  })
}
