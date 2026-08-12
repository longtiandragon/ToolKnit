const MARKDOWN_OPEN_LIMIT = 8
const MARKDOWN_EXTENSION = /\.(?:md|mdx|markdown|mkd)$/i

export function normalizeMarkdownOpenPaths(paths: string[]) {
  const unique = new Map<string, string>()
  for (const rawPath of paths) {
    const path = rawPath.trim()
    if (!path || !MARKDOWN_EXTENSION.test(path)) continue
    const identity = path.replaceAll('/', '\\').toLocaleLowerCase()
    if (!unique.has(identity)) unique.set(identity, path)
    if (unique.size >= MARKDOWN_OPEN_LIMIT) break
  }
  return [...unique.values()]
}

export function isMarkdownOpenShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>) {
  return (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLocaleLowerCase() === 'o'
}
