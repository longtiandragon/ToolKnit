export interface WikiLink {
  target: string
  heading?: string
  label: string
  start: number
  end: number
}

export interface ExternalWikiCandidate {
  name: string
  relativePath: string
}

const wikiLinkPattern = /\[\[([^\]|#\n]+)(?:#([^|\]\n]+))?(?:\|([^\]\n]+))?\]\]/g

/** Keeps an Obsidian-compatible wiki link as plain Markdown while exposing the
 * small amount of structure needed for rendering, navigation and backlinks. */
export function parseWikiLinks(source: string): WikiLink[] {
  const links: WikiLink[] = []
  wikiLinkPattern.lastIndex = 0
  for (const match of source.matchAll(wikiLinkPattern)) {
    const target = match[1].trim()
    if (!target) continue
    const heading = match[2]?.trim() || undefined
    const label = match[3]?.trim() || target
    links.push({ target, heading, label, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })
  }
  return links
}

export function normalizeWikiTitle(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

function normalizeExternalWikiPath(value: string) {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.(?:md|mdx|markdown|mkd)$/i, '')
    .split('/')
    .map(normalizeWikiTitle)
    .join('/')
}

/** Obsidian-style links may name either `Note` or `folder/Note`. Only exact
 * stem/path matches are accepted here; fuzzy native search merely supplies a
 * bounded candidate set and must never navigate to a similarly named note. */
export function externalWikiExactMatches<T extends ExternalWikiCandidate>(target: string, candidates: T[]) {
  const normalizedTarget = normalizeExternalWikiPath(target)
  if (!normalizedTarget) return [] as T[]
  const pathQualified = normalizedTarget.includes('/')
  return candidates
    .flatMap((candidate) => {
      const normalizedPath = normalizeExternalWikiPath(candidate.relativePath)
      const stem = normalizedPath.split('/').at(-1) ?? normalizedPath
      const exactPath = normalizedPath === normalizedTarget
      const exactStem = !pathQualified && stem === normalizedTarget
      return exactPath || exactStem ? [{ candidate, rank: exactPath ? 0 : 1, path: normalizedPath }] : []
    })
    .sort((left, right) => left.rank - right.rank || left.path.localeCompare(right.path, 'zh-CN'))
    .map(item => item.candidate)
}

export function wikiLinkSource(target: string, heading?: string, label?: string) {
  const cleanedTarget = target.trim()
  const cleanedHeading = heading?.trim()
  const cleanedLabel = label?.trim()
  return `[[${cleanedTarget}${cleanedHeading ? `#${cleanedHeading}` : ''}${cleanedLabel && cleanedLabel !== cleanedTarget ? `|${cleanedLabel}` : ''}]]`
}
