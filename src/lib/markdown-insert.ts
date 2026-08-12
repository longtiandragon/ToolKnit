export type MarkdownTableAlignment = 'default' | 'left' | 'center' | 'right'
export type MarkdownFormulaMode = 'inline' | 'block'

export type MarkdownInsertion = {
  text: string
  selectionStart: number
  selectionEnd: number
}

export type MarkdownTableOptions = {
  columns: number
  rows: number
  fillHeader?: boolean
  alignment?: MarkdownTableAlignment
}

function boundedInteger(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(Number.isFinite(value) ? value : minimum)))
}

function tableRow(cells: string[]) {
  return `| ${cells.join(' | ')} |`
}

function alignmentMarker(alignment: MarkdownTableAlignment) {
  if (alignment === 'left') return ':---'
  if (alignment === 'center') return ':---:'
  if (alignment === 'right') return '---:'
  return '---'
}

/**
 * Creates portable GFM table source without touching the surrounding document.
 * Dimensions are deliberately bounded so a mistaken wheel/click cannot insert
 * thousands of cells into an otherwise responsive editor.
 */
export function createMarkdownTable(options: MarkdownTableOptions): MarkdownInsertion {
  const columns = boundedInteger(options.columns, 1, 8)
  const rows = boundedInteger(options.rows, 1, 12)
  const fillHeader = options.fillHeader !== false
  const alignment = options.alignment ?? 'default'
  const headers = Array.from({ length: columns }, (_, index) => fillHeader ? `列 ${index + 1}` : '')
  const body = Array.from({ length: rows }, () => Array.from({ length: columns }, () => '内容'))
  const lines = [
    tableRow(headers),
    tableRow(Array.from({ length: columns }, () => alignmentMarker(alignment))),
    ...body.map(tableRow),
  ]
  const text = lines.join('\n')
  const selectionText = fillHeader ? headers[0] : body[0][0]
  const selectionStart = fillHeader ? 2 : lines[0].length + 1 + lines[1].length + 3
  return { text, selectionStart, selectionEnd: selectionStart + selectionText.length }
}

export function normalizeMarkdownFormulaSource(source: string) {
  const trimmed = source.trim()
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) return trimmed.slice(2, -2).trim()
  if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length >= 2) return trimmed.slice(1, -1).trim()
  return trimmed
}

export function createMarkdownFormula(source: string, mode: MarkdownFormulaMode): MarkdownInsertion {
  const body = normalizeMarkdownFormulaSource(source) || 'x^2'
  if (mode === 'inline') return { text: `$${body}$`, selectionStart: 1, selectionEnd: 1 + body.length }
  return { text: `$$\n${body}\n$$`, selectionStart: 3, selectionEnd: 3 + body.length }
}

/** Adds only the blank lines a Markdown block needs at the current selection. */
export function placeMarkdownBlock(document: string, from: number, to: number, insertion: MarkdownInsertion): MarkdownInsertion {
  const start = boundedInteger(Math.min(from, to), 0, document.length)
  const end = boundedInteger(Math.max(from, to), start, document.length)
  const before = document.slice(0, start)
  const after = document.slice(end)
  const body = insertion.text.replace(/^\n+|\n+$/g, '')
  const prefix = !before ? '' : /\n[\t ]*\n$/.test(before) ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const suffix = !after ? '' : /^\n[\t ]*\n/.test(after) ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  return {
    text: `${prefix}${body}${suffix}`,
    selectionStart: prefix.length + insertion.selectionStart,
    selectionEnd: prefix.length + insertion.selectionEnd,
  }
}
