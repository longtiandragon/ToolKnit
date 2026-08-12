export const PREVIEW_SELECTION_TEXT_LIMIT = 120_000
export const PREVIEW_SELECTION_HTML_LIMIT = 360_000
export const PREVIEW_SELECTION_MARKDOWN_LIMIT = 180_000

export interface PreviewSelectionPayload {
  text: string
  html: string
  textTruncated: boolean
  htmlTruncated: boolean
  markdown?: string
  markdownTruncated?: boolean
}

export type PreviewSelectionNode =
  | { type: 'text'; value: string }
  | { type: 'element'; tag: string; attrs?: Record<string, string>; children: PreviewSelectionNode[] }

/**
 * Keep rendered-preview context actions bounded. A browser selection can span
 * a surprisingly large reader; downstream tools should never receive an
 * unbounded DOM serialization on the main thread.
 */
export function normalizePreviewSelection(text: string, html = ''): PreviewSelectionPayload | undefined {
  const normalizedText = text.trim()
  if (!normalizedText) return undefined
  const normalizedHtml = html.trim()
  return {
    text: normalizedText.slice(0, PREVIEW_SELECTION_TEXT_LIMIT),
    html: normalizedHtml.slice(0, PREVIEW_SELECTION_HTML_LIMIT),
    textTruncated: normalizedText.length > PREVIEW_SELECTION_TEXT_LIMIT,
    htmlTruncated: normalizedHtml.length > PREVIEW_SELECTION_HTML_LIMIT,
  }
}

export function previewSelectionSummary(text: string, maxLength = 42) {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

function elementAttribute(node: Extract<PreviewSelectionNode, { type: 'element' }>, name: string) {
  return node.attrs?.[name] ?? ''
}

function hasElementAttribute(node: Extract<PreviewSelectionNode, { type: 'element' }>, name: string) {
  return Object.prototype.hasOwnProperty.call(node.attrs ?? {}, name)
}

function plainText(nodes: PreviewSelectionNode[]): string {
  return nodes.map((node) => node.type === 'text' ? node.value : plainText(node.children)).join('')
}

function descendant(node: Extract<PreviewSelectionNode, { type: 'element' }>, tag: string): Extract<PreviewSelectionNode, { type: 'element' }> | undefined {
  for (const child of node.children) {
    if (child.type !== 'element') continue
    if (child.tag === tag) return child
    const nested = descendant(child, tag)
    if (nested) return nested
  }
  return undefined
}

function escapeInlineMarkdown(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').replace(/([\\`*_\[\]<>])/g, '\\$1')
}

function compactInline(value: string) {
  return value.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}

function fencedCode(value: string, language = '') {
  const longestRun = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}${language.replace(/[^\w#+.-]/g, '')}\n${value.replace(/^\n+|\n+$/g, '')}\n${fence}`
}

function renderTable(node: Extract<PreviewSelectionNode, { type: 'element' }>, render: (nodes: PreviewSelectionNode[], inline?: boolean) => string) {
  const rows: Array<Array<{ value: string; header: boolean }>> = []
  const walk = (candidate: PreviewSelectionNode) => {
    if (candidate.type !== 'element') return
    if (candidate.tag === 'tr') {
      const cells = candidate.children
        .filter((child): child is Extract<PreviewSelectionNode, { type: 'element' }> => child.type === 'element' && (child.tag === 'th' || child.tag === 'td'))
        .map((cell) => ({ value: compactInline(render(cell.children, true)).replace(/\|/g, '\\|').replace(/\n/g, '<br>'), header: cell.tag === 'th' }))
      if (cells.length) rows.push(cells)
      return
    }
    candidate.children.forEach(walk)
  }
  walk(node)
  if (!rows.length) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index]?.value ?? ''))
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.header))
  const ordered = headerIndex > 0 ? [normalized[headerIndex]!, ...normalized.filter((_, index) => index !== headerIndex)] : normalized
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [line(ordered[0]!), line(Array.from({ length: width }, () => '---')), ...ordered.slice(1).map(line)].join('\n')
}

/**
 * Serialize the bounded rendered selection, not the whole document. The small
 * tree keeps this logic testable without a browser DOM and deliberately
 * ignores preview-only controls such as copy buttons and SVG decoration.
 */
export function previewSelectionTreeToMarkdown(nodes: PreviewSelectionNode[]) {
  const render = (items: PreviewSelectionNode[], inline = false): string => items.map((node) => {
    if (node.type === 'text') return escapeInlineMarkdown(node.value)
    const tag = node.tag.toLowerCase()
    if (['button', 'svg', 'style', 'script'].includes(tag) || elementAttribute(node, 'aria-hidden') === 'true') return ''
    const content = () => render(node.children, true)
    const block = (value: string) => inline ? value : `\n\n${value}\n\n`
    if (/^h[1-6]$/.test(tag)) return block(`${'#'.repeat(Number(tag[1]))} ${compactInline(content())}`)
    if (tag === 'p') return block(compactInline(content()))
    if (tag === 'br') return '\n'
    if (tag === 'hr') return block('---')
    if (tag === 'strong' || tag === 'b') return `**${compactInline(content())}**`
    if (tag === 'em' || tag === 'i') return `*${compactInline(content())}*`
    if (tag === 'del' || tag === 's') return `~~${compactInline(content())}~~`
    if (tag === 'mark') return `==${compactInline(content())}==`
    if (tag === 'code' && !elementAttribute(node, 'class').includes('language-')) {
      const value = plainText(node.children).replace(/\u00a0/g, ' ')
      const longestRun = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length))
      const fence = '`'.repeat(longestRun + 1)
      const padding = /^\s|\s$|^`|`$/.test(value) ? ' ' : ''
      return `${fence}${padding}${value}${padding}${fence}`
    }
    if (tag === 'pre' || elementAttribute(node, 'class').split(/\s+/).includes('code-frame')) {
      const code = tag === 'pre' ? descendant(node, 'code') ?? node : descendant(node, 'code')
      if (!code) return block(compactInline(content()))
      const language = elementAttribute(code, 'data-deferred-code-language') || elementAttribute(code, 'class').match(/(?:^|\s)language-([^\s]+)/)?.[1] || ''
      return block(fencedCode(plainText(code.children), language))
    }
    if (tag === 'blockquote') {
      const value = previewSelectionTreeToMarkdown(node.children).split('\n').map((line) => line ? `> ${line}` : '>').join('\n')
      return block(value)
    }
    if (tag === 'a') {
      const label = compactInline(content())
      const href = elementAttribute(node, 'href')
      if (!href) return label
      const title = elementAttribute(node, 'title')
      return `[${label || href}](${href.replace(/([()])/g, '\\$1')}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
    }
    if (tag === 'img') {
      const alt = elementAttribute(node, 'alt').replace(/[\[\]]/g, '')
      const src = elementAttribute(node, 'data-external-image-src') || elementAttribute(node, 'src')
      return src ? `![${alt}](${src.replace(/([()])/g, '\\$1')})` : ''
    }
    if (tag === 'input' && elementAttribute(node, 'type') === 'checkbox') return hasElementAttribute(node, 'checked') ? '[x] ' : '[ ] '
    if (tag === 'ul' || tag === 'ol') {
      let ordinal = Number(elementAttribute(node, 'start')) || 1
      const lines = node.children
        .filter((child): child is Extract<PreviewSelectionNode, { type: 'element' }> => child.type === 'element' && child.tag === 'li')
        .map((item) => {
          const nested = item.children.filter((child) => child.type === 'element' && (child.tag === 'ul' || child.tag === 'ol'))
          const body = compactInline(render(item.children.filter((child) => !nested.includes(child)), true))
          const marker = tag === 'ol' ? `${ordinal++}. ` : '- '
          const continuation = body.split('\n').map((line, index) => index ? `  ${line}` : `${marker}${line}`).join('\n')
          const children = nested.map((child) => render([child]).trim().split('\n').map((line) => `  ${line}`).join('\n')).join('\n')
          return children ? `${continuation}\n${children}` : continuation
        })
      return block(lines.join('\n'))
    }
    if (tag === 'table') return block(renderTable(node, render))
    if (['thead', 'tbody', 'tfoot', 'tr', 'th', 'td'].includes(tag)) return content()
    if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'figure' || tag === 'figcaption') return block(compactInline(content()))
    return content()
  }).join('')
  return render(nodes).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function previewSelectionMarkdown(fragment: ParentNode, fallbackText = '') {
  const toTree = (node: Node): PreviewSelectionNode | undefined => {
    if (node.nodeType === Node.TEXT_NODE) return { type: 'text', value: node.textContent ?? '' }
    if (node.nodeType !== Node.ELEMENT_NODE) return undefined
    const element = node as Element
    return {
      type: 'element',
      tag: element.tagName.toLowerCase(),
      attrs: Object.fromEntries(element.getAttributeNames().map((name) => [name, element.getAttribute(name) ?? ''])),
      children: [...element.childNodes].flatMap((child) => toTree(child) ?? []),
    }
  }
  const markdown = previewSelectionTreeToMarkdown([...fragment.childNodes].flatMap((node) => toTree(node) ?? []))
  return markdown || fallbackText.trim()
}
