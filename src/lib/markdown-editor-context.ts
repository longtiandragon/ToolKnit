export type MarkdownEditorContextKind = 'selection' | 'code' | 'inline-code' | 'image' | 'link' | 'wiki-link' | 'heading' | 'list' | 'text'

export type MarkdownEditorContextSnapshot = {
  kind: MarkdownEditorContextKind
  label: string
  detail: string
  line: number
  text?: string
  target?: string
  language?: string
  truncated?: boolean
}

const MAX_CONTEXT_TEXT = 120_000

function inlineTargetAt(line: string, column: number) {
  const expression = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
  for (const match of line.matchAll(expression)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (column < start || column > end) continue
    return {
      kind: match[1] ? 'image' as const : 'link' as const,
      label: match[1] ? '图片' : '链接',
      detail: match[2] || match[3],
      target: match[3],
    }
  }
}

function wikiTargetAt(line: string, column: number) {
  const expression = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g
  for (const match of line.matchAll(expression)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (column < start || column > end) continue
    const title = match[1].trim()
    const heading = match[2]?.trim()
    return {
      kind: 'wiki-link' as const,
      label: '笔记双链',
      detail: match[3]?.trim() || (heading ? `${title} · ${heading}` : title),
      target: heading ? `${title}#${heading}` : title,
    }
  }
}

function inlineCodeAt(line: string, column: number) {
  const expression = /(`+)([^`\n]+?)\1/g
  for (const match of line.matchAll(expression)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (column < start || column > end) continue
    return {
      kind: 'inline-code' as const,
      label: '行内代码',
      detail: match[2],
      text: match[2],
    }
  }
}

function fenceAt(lines: string[], activeIndex: number) {
  let opener: { index: number; marker: string; language: string } | undefined
  for (let index = 0; index <= activeIndex; index += 1) {
    const line = lines[index] ?? ''
    if (!opener) {
      const match = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`~]*)?.*$/)
      if (match) opener = { index, marker: match[1], language: match[2] ?? '' }
      continue
    }
    const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/)?.[1]
    if (close?.[0] === opener.marker[0] && close.length >= opener.marker.length) opener = undefined
  }
  if (!opener) return undefined

  let closeIndex = lines.length
  for (let index = activeIndex + 1; index < lines.length; index += 1) {
    const close = lines[index]?.match(/^\s{0,3}(`{3,}|~{3,})\s*$/)?.[1]
    if (close?.[0] === opener.marker[0] && close.length >= opener.marker.length) { closeIndex = index; break }
  }
  const fullText = lines.slice(opener.index + 1, closeIndex).join('\n')
  return {
    language: opener.language,
    text: fullText.slice(0, MAX_CONTEXT_TEXT),
    truncated: fullText.length > MAX_CONTEXT_TEXT,
  }
}

/** Detects the local Markdown construct around a cursor from a bounded line
 * window. The editor deliberately supplies only nearby lines so opening a
 * context menu never serializes or reparses a multi-megabyte document. */
export function detectMarkdownEditorContext(
  lines: string[],
  activeIndex: number,
  column: number,
  lineNumber: number,
  selectedText = '',
): MarkdownEditorContextSnapshot {
  if (selectedText) {
    return {
      kind: 'selection',
      label: '已选择内容',
      detail: `${selectedText.length.toLocaleString('zh-CN')} 字`,
      line: lineNumber,
      text: selectedText.slice(0, MAX_CONTEXT_TEXT),
      truncated: selectedText.length > MAX_CONTEXT_TEXT,
    }
  }

  const line = lines[activeIndex] ?? ''
  const fence = fenceAt(lines, activeIndex)
  if (fence) return {
    kind: 'code',
    label: '代码块',
    detail: fence.language || '纯文本',
    line: lineNumber,
    ...fence,
  }

  const wiki = wikiTargetAt(line, column)
  if (wiki) return { ...wiki, line: lineNumber, text: line }
  const inlineCode = inlineCodeAt(line, column)
  if (inlineCode) return { ...inlineCode, line: lineNumber }
  const inline = inlineTargetAt(line, column)
  if (inline) return { ...inline, line: lineNumber, text: line }

  const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
  if (heading) return { kind: 'heading', label: `${heading[1].length} 级标题`, detail: heading[2], line: lineNumber, text: heading[2] }
  const list = line.match(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/)
  if (list) return { kind: 'list', label: '列表项', detail: list[1], line: lineNumber, text: line }

  const detail = line.trim()
  return { kind: 'text', label: detail ? '正文段落' : '空白位置', detail: detail || `第 ${lineNumber} 行`, line: lineNumber, text: line }
}
