export interface MarkdownOutlineItem {
  label: string
  level: number
  /** Zero-based order among headings in the source. */
  index: number
  /** One-based line number in the original Markdown source, when available. */
  sourceLine?: number
}

export const MAX_MARKDOWN_OUTLINE_ITEMS = 4_000

function readableHeadingLabel(source: string) {
  return source
    .replace(/\s+#+\s*$/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|([^\]]+))?\]\]/g, (_match, target: string, label: string | undefined) => label || target)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extracts a navigation-only outline without invoking Markdown-It, KaTeX or
 * syntax highlighting. It deliberately skips fenced code so examples such as
 * `#include` never become false document headings.
 */
export function extractMarkdownOutline(source: string, limit = MAX_MARKDOWN_OUTLINE_ITEMS): MarkdownOutlineItem[] {
  const items: MarkdownOutlineItem[] = []
  let fenceMarker = ''
  let fenceLength = 0
  const lines = source.replace(/\r/g, '').split('\n')

  for (let lineIndex = 0; lineIndex < lines.length && items.length < limit; lineIndex += 1) {
    const line = lines[lineIndex]
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      const marker = fence[1][0]
      if (!fenceMarker) {
        fenceMarker = marker
        fenceLength = fence[1].length
      } else if (marker === fenceMarker && fence[1].length >= fenceLength) {
        fenceMarker = ''
        fenceLength = 0
      }
      continue
    }
    if (fenceMarker) continue

    const heading = /^(?: {0,3})(#{1,6})[ \t]+(.+?)\s*$/.exec(line)
    if (!heading) continue
    const label = readableHeadingLabel(heading[2])
    if (!label) continue
    items.push({ label, level: heading[1].length, index: items.length, sourceLine: lineIndex + 1 })
  }
  return items
}
