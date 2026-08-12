export type KnowledgeSnippetPart = { text: string; highlighted: boolean }

/** SQLite FTS snippets use square brackets as highlight markers. Convert them
 * into plain Vue-rendered segments instead of trusting the snippet as HTML. */
export function knowledgeSnippetParts(value: string, maxLength = 220): KnowledgeSnippetPart[] {
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, Math.max(0, Math.trunc(maxLength)))
  if (!normalized) return []

  const parts: KnowledgeSnippetPart[] = []
  const pattern = /\[([^\]]+)\]/g
  let cursor = 0
  for (const match of normalized.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ text: normalized.slice(cursor, index), highlighted: false })
    if (match[1]) parts.push({ text: match[1], highlighted: true })
    cursor = index + match[0].length
  }
  if (cursor < normalized.length) parts.push({ text: normalized.slice(cursor), highlighted: false })
  return parts.length ? parts : [{ text: normalized, highlighted: false }]
}

export function knowledgeSnippetText(value: string, maxLength = 220) {
  return knowledgeSnippetParts(value, maxLength).map((part) => part.text).join('')
}
