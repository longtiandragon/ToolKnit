export const RICH_CLIPBOARD_HTML_LIMIT = 400_000
export const RICH_CLIPBOARD_MARKDOWN_LIMIT = 300_000

export type RichClipboardMarkdown = {
  markdown: string
  truncated: boolean
  rich: boolean
}

export type ArticleExtractionConfidence = 'high' | 'medium' | 'low'

export type WebArticleExtraction = {
  title: string
  markdown: string
  byline?: string
  publishedAt?: string
  siteName?: string
  confidence: ArticleExtractionConfidence
  truncated: boolean
  removedBlocks: number
  sourceCharacters: number
  images: Array<{ source: string; alt: string }>
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

const articleTags = new Set(['article', 'main'])
const noiseTags = new Set(['head', 'nav', 'aside', 'footer', 'form', 'dialog', 'button', 'iframe', 'object', 'embed'])
const positiveArticleSignal = /(?:^|[-_\s])(article|content|entry|main|post|story|正文|文章)(?:$|[-_\s])/i
const negativeArticleSignal = /(?:^|[-_\s])(ad|ads|advert|banner|breadcrumb|comment|cookie|consent|footer|header|menu|modal|nav|newsletter|pagination|promo|recommend|related|share|sidebar|social|subscribe|toolbar)(?:$|[-_\s])/i

function visitNodes(node: HtmlNode, visit: (node: HtmlNode) => void) {
  visit(node)
  node.children.forEach(child => visitNodes(child, visit))
}

function compactText(node: HtmlNode) {
  return plainText(node).replace(/\s+/g, ' ').trim()
}

function attributeSignal(node: HtmlNode) {
  return `${node.attrs.id ?? ''} ${node.attrs.class ?? ''} ${node.attrs.role ?? ''}`.trim()
}

function articleScore(node: HtmlNode) {
  const textLength = compactText(node).length
  // Chinese paragraphs carry much more information per character than Latin
  // prose, so a semantic container should not need hundreds of characters.
  if (textLength < 40) return Number.NEGATIVE_INFINITY
  let paragraphs = 0
  let headings = 0
  let linkCharacters = 0
  visitNodes(node, child => {
    if (child.tag === 'p') paragraphs += 1
    if (/^h[1-6]$/.test(child.tag)) headings += 1
    if (child.tag === 'a') linkCharacters += compactText(child).length
  })
  const signal = attributeSignal(node)
  const semantic = node.tag === 'article' ? 150 : node.tag === 'main' ? 120 : positiveArticleSignal.test(signal) ? 70 : 0
  const negative = negativeArticleSignal.test(signal) ? 240 : 0
  const linkDensity = textLength ? linkCharacters / textLength : 1
  return semantic + Math.min(textLength, 12_000) / 80 + Math.min(paragraphs, 30) * 14 + Math.min(headings, 8) * 5 - linkDensity * 180 - negative
}

function readableClone(node: HtmlNode, preserveHeader: boolean, removed: { count: number }): HtmlNode | undefined {
  const signal = attributeSignal(node)
  const role = node.attrs.role?.toLowerCase()
  const hidden = 'hidden' in node.attrs || node.attrs['aria-hidden'] === 'true'
  const noisyRole = role === 'navigation' || role === 'complementary' || role === 'banner' || role === 'contentinfo'
  if (hidden || noiseTags.has(node.tag) || (!preserveHeader && node.tag === 'header') || noisyRole || negativeArticleSignal.test(signal)) {
    removed.count += 1
    return undefined
  }
  return {
    ...node,
    attrs: { ...node.attrs },
    children: node.children.map(child => readableClone(child, preserveHeader, removed)).filter((child): child is HtmlNode => Boolean(child)),
  }
}

function metaContent(root: HtmlNode, names: readonly string[]) {
  const accepted = new Set(names.map(name => name.toLowerCase()))
  let result = ''
  visitNodes(root, node => {
    if (result || node.tag !== 'meta') return
    const key = (node.attrs.property || node.attrs.name || node.attrs.itemprop || '').toLowerCase()
    if (accepted.has(key)) result = (node.attrs.content ?? '').trim()
  })
  return result
}

function firstTagText(root: HtmlNode, tags: readonly string[]) {
  const accepted = new Set(tags)
  let result = ''
  visitNodes(root, node => {
    if (!result && accepted.has(node.tag)) result = compactText(node)
  })
  return result
}

function metadataValue(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim().slice(0, 300)
}

export function extractWebArticle(html: string): WebArticleExtraction {
  const sourceTruncated = html.length > RICH_CLIPBOARD_HTML_LIMIT
  const source = html.slice(0, RICH_CLIPBOARD_HTML_LIMIT)
  const parsed = parseHtmlFragment(source)
  const candidates: Array<{ node: HtmlNode; score: number }> = []
  visitNodes(parsed.root, node => {
    if (articleTags.has(node.tag) || positiveArticleSignal.test(attributeSignal(node))) {
      candidates.push({ node, score: articleScore(node) })
    }
  })
  candidates.sort((left, right) => right.score - left.score)
  const winner = candidates.find(candidate => Number.isFinite(candidate.score))
  const selected = winner?.node ?? parsed.root
  const removed = { count: 0 }
  const readable = readableClone(selected, selected.tag === 'article' || selected.tag === 'main', removed) ?? { tag: 'root', attrs: {}, children: [] }
  const rendered = cleanMarkdown(selected.tag === 'root' ? renderChildren(readable, 0, 0) : renderNode(readable))
  const title = metadataValue(
    metaContent(parsed.root, ['og:title', 'twitter:title'])
      || firstTagText(selected, ['h1'])
      || firstTagText(parsed.root, ['title', 'h1']),
  )
  const outputTruncated = rendered.length > RICH_CLIPBOARD_MARKDOWN_LIMIT
  const markdown = rendered.slice(0, RICH_CLIPBOARD_MARKDOWN_LIMIT)
  const textLength = compactText(readable).length
  const images: Array<{ source: string; alt: string }> = []
  const imageSources = new Set<string>()
  visitNodes(readable, node => {
    if (images.length >= 20 || node.tag !== 'img') return
    const source = safeTarget(node.attrs.src).replace(/\\([()])/g, '$1')
    if (!source || imageSources.has(source)) return
    imageSources.add(source)
    images.push({ source, alt: metadataValue(node.attrs.alt ?? '').slice(0, 160) })
  })
  const confidence: ArticleExtractionConfidence = winner
    ? winner.score >= 270 && textLength >= 500 ? 'high' : 'medium'
    : 'low'
  return {
    title: title || '未命名网页',
    markdown,
    byline: metadataValue(metaContent(parsed.root, ['author', 'article:author', 'parsely-author'])) || undefined,
    publishedAt: metadataValue(metaContent(parsed.root, ['article:published_time', 'date', 'datepublished'])) || undefined,
    siteName: metadataValue(metaContent(parsed.root, ['og:site_name'])) || undefined,
    confidence,
    truncated: sourceTruncated || parsed.nodeLimitReached || outputTruncated,
    removedBlocks: removed.count,
    sourceCharacters: html.length,
    images,
  }
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
