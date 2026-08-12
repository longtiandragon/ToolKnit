const FRONTMATTER_MAX_CHARACTERS = 64 * 1024
const FRONTMATTER_MAX_LINES = 400

export interface MarkdownFrontmatterBlock {
  raw: string
  yaml: string
  bodyStart: number
}

function lineEnd(source: string, start: number) {
  const end = source.indexOf('\n', start)
  return end < 0 ? source.length : end
}

/** Locate only a complete YAML header at the beginning of a document. An
 * unterminated or implausibly large header remains ordinary Markdown so a
 * malformed file never makes the rest of the note disappear from preview. */
export function markdownFrontmatterBlock(source: string): MarkdownFrontmatterBlock | undefined {
  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0
  const firstEnd = lineEnd(source, start)
  if (source.slice(start, firstEnd).replace(/\r$/, '').trim() !== '---') return undefined

  let cursor = firstEnd < source.length ? firstEnd + 1 : source.length
  let lines = 1
  while (cursor <= source.length && cursor - start <= FRONTMATTER_MAX_CHARACTERS && lines <= FRONTMATTER_MAX_LINES) {
    const end = lineEnd(source, cursor)
    const line = source.slice(cursor, end).replace(/\r$/, '').trim()
    if (line === '---' || line === '...') {
      const bodyStart = end < source.length ? end + 1 : end
      return {
        raw: source.slice(start, bodyStart),
        yaml: source.slice(firstEnd < source.length ? firstEnd + 1 : firstEnd, cursor),
        bodyStart,
      }
    }
    if (end >= source.length) break
    cursor = end + 1
    lines += 1
  }
  return undefined
}

export function stripMarkdownFrontmatter(source: string) {
  const block = markdownFrontmatterBlock(source)
  return block ? source.slice(block.bodyStart) : source
}

