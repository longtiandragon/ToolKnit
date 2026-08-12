export const RICH_CLIPBOARD_HTML_LIMIT = 400_000
export const RICH_CLIPBOARD_MARKDOWN_LIMIT = 300_000

export type RichClipboardMarkdown = {
  markdown: string
  truncated: boolean
  rich: boolean
}

type HtmlNode = { tag: string; attrs: Record<string, string>; children: HtmlNode[]; text?: string }

const richTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'strike', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'img', 'hr'])
const voidTags = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'source', 'wbr'])
const ignoredTags = new Set(['script', 'style', 'svg', 'canvas', 'noscript', 'template'])

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ' }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (entity, token: string) => {
    if (token[0] !== '#') return named[token.toLowerCase()] ?? entity
    const hexadecimal = token[1]?.toLowerCase() === 'x'
    const point = Number.parseInt(token.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
  })
}

function parseAttributes(source: string) {
  const attributes: Record<string, string> = {}
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase()
    if (name === 'style' || name.startsWith('on')) continue
    attributes[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

function parseHtmlFragment(source: string) {
  const root: HtmlNode = { tag: 'root', attrs: {}, children: [] }
  const stack = [root]
  let ignoredDepth = 0
  let nodes = 0
  let rich = false
  const tokens = source.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+|</g)
  for (const token of tokens) {
    if (nodes >= 20_000) break
    const value = token[0]
    if (!value.startsWith('<')) {
      if (!ignoredDepth && value) {
        stack.at(-1)!.children.push({ tag: '#text', attrs: {}, children: [], text: decodeHtmlEntities(value) })
        nodes += 1
      }
      continue
    }
    if (/^<!/.test(value)) continue
    const closing = /^<\//.test(value)
    const tag = value.match(/^<\/?\s*([\w-]+)/)?.[1]?.toLowerCase()
    if (!tag) continue
    if (closing) {
      if (ignoredDepth) {
        if (ignoredTags.has(tag)) ignoredDepth -= 1
        continue
      }
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag !== tag) continue
        stack.length = index
        break
      }
      continue
    }
    if (ignoredTags.has(tag)) {
      ignoredDepth += 1
      continue
    }
    if (ignoredDepth) continue
    const tagEnd = value.indexOf(tag) + tag.length
    const node: HtmlNode = { tag, attrs: parseAttributes(value.slice(tagEnd, value.endsWith('/>') ? -2 : -1)), children: [] }
    stack.at(-1)!.children.push(node)
    nodes += 1
    if (richTags.has(tag)) rich = true
    if (!voidTags.has(tag) && !/\/\s*>$/.test(value) && stack.length < 64) stack.push(node)
  }
  return { root, rich, nodeLimitReached: nodes >= 20_000 }
}

function safeTarget(value: string | undefined) {
  const target = value?.trim().replace(/[\r\n]+/g, '') ?? ''
  if (!target || /^(?:javascript|vbscript|file|data):/i.test(target)) return ''
  if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^(?:https?|mailto|tel):/i.test(target)) return ''
  return target.replace(/[()]/g, '\\$&')
}

function escapeInline(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/([`*_{}\[\]<>])/g, '\\$1')
}

function plainText(node: HtmlNode): string {
  return node.tag === '#text' ? node.text ?? '' : node.children.map(plainText).join('')
}

function renderChildren(node: HtmlNode, depth: number, listDepth: number) {
  return node.children.map((child) => renderNode(child, depth + 1, listDepth)).join('')
}

function renderTable(node: HtmlNode, depth: number) {
  const rows: string[][] = []
  const visit = (current: HtmlNode) => {
    if (current.tag === 'tr') {
      const cells = current.children.filter((child) => child.tag === 'td' || child.tag === 'th')
        .map((cell) => renderChildren(cell, depth + 1, 0).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|'))
      if (cells.length) rows.push(cells)
      return
    }
    current.children.forEach(visit)
  }
  visit(node)
  if (!rows.length) return ''
  const columns = Math.min(12, Math.max(...rows.map((row) => row.length)))
  const normalized = rows.slice(0, 200).map((row) => Array.from({ length: columns }, (_, index) => row[index] ?? ''))
  return `\n\n| ${normalized[0].join(' | ')} |\n| ${Array.from({ length: columns }, () => '---').join(' | ')} |${normalized.slice(1).map((row) => `\n| ${row.join(' | ')} |`).join('')}\n\n`
}

function renderNode(node: HtmlNode, depth = 0, listDepth = 0): string {
  if (depth > 72) return ''
  if (node.tag === '#text') return escapeInline((node.text ?? '').replace(/\s+/g, ' '))
  if (node.tag === 'br') return '  \n'
  if (node.tag === 'hr') return '\n\n---\n\n'
  if (node.tag === 'img') {
    const source = safeTarget(node.attrs.src)
    return source ? `![${escapeInline(node.attrs.alt ?? '')}](${source})` : ''
  }
  if (node.tag === 'pre') {
    const body = plainText(node).replace(/^\n|\n$/g, '')
    const language = node.attrs.class?.match(/(?:^|\s)language-([\w+-]+)/)?.[1]
      ?? node.children.find((child) => child.tag === 'code')?.attrs.class?.match(/(?:^|\s)language-([\w+-]+)/)?.[1]
      ?? ''
    const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
    const fence = '`'.repeat(Math.max(3, longest + 1))
    return `\n\n${fence}${language}\n${body}\n${fence}\n\n`
  }
  if (node.tag === 'table') return renderTable(node, depth)
  const content = node.tag === 'li'
    ? node.children.map((child) => renderNode(child, depth + 1, child.tag === 'ul' || child.tag === 'ol' ? listDepth + 1 : listDepth)).join('')
    : renderChildren(node, depth, listDepth)
  if (/^h[1-6]$/.test(node.tag)) return `\n\n${'#'.repeat(Number(node.tag[1]))} ${content.trim()}\n\n`
  if (node.tag === 'p' || node.tag === 'div' || node.tag === 'section' || node.tag === 'article' || node.tag === 'header' || node.tag === 'footer') return `\n\n${content.trim()}\n\n`
  if (node.tag === 'strong' || node.tag === 'b') return content.trim() ? `**${content.trim()}**` : ''
  if (node.tag === 'em' || node.tag === 'i') return content.trim() ? `*${content.trim()}*` : ''
  if (node.tag === 'del' || node.tag === 's' || node.tag === 'strike') return content.trim() ? `~~${content.trim()}~~` : ''
  if (node.tag === 'code') {
    const body = plainText(node).trim()
    const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
    const fence = '`'.repeat(Math.max(1, longest + 1))
    const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : ''
    return body ? `${fence}${pad}${body}${pad}${fence}` : ''
  }
  if (node.tag === 'a') {
    const label = content.trim()
    const target = safeTarget(node.attrs.href)
    return target && label ? `[${label}](${target})` : label
  }
  if (node.tag === 'blockquote') return `\n\n${content.trim().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`
  if (node.tag === 'li') {
    const parentOrdered = node.attrs['data-parent-list'] === 'ol'
    const marker = parentOrdered ? `${node.attrs['data-index'] ?? '1'}.` : '-'
    return `${'  '.repeat(listDepth)}${marker} ${content.trim()}\n`
  }
  if (node.tag === 'ul' || node.tag === 'ol') {
    let index = 1
    for (const child of node.children) {
      if (child.tag !== 'li') continue
      child.attrs['data-parent-list'] = node.tag
      child.attrs['data-index'] = String(index++)
    }
    return `\n${node.children.map((child) => renderNode(child, depth + 1, listDepth)).join('')}\n`
  }
  return content
}

function cleanMarkdown(value: string) {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
}

export function htmlToMarkdown(html: string): RichClipboardMarkdown {
  const sourceTruncated = html.length > RICH_CLIPBOARD_HTML_LIMIT
  const source = html.slice(0, RICH_CLIPBOARD_HTML_LIMIT)
  const parsed = parseHtmlFragment(source)
  const rendered = cleanMarkdown(renderChildren(parsed.root, 0, 0))
  const outputTruncated = rendered.length > RICH_CLIPBOARD_MARKDOWN_LIMIT
  return {
    markdown: rendered.slice(0, RICH_CLIPBOARD_MARKDOWN_LIMIT),
    truncated: sourceTruncated || parsed.nodeLimitReached || outputTruncated,
    rich: parsed.rich,
  }
}
