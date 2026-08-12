import MarkdownIt from 'markdown-it'
import katex from 'katex'
import { highlightCode } from '@/lib/code-highlight'
import { stripMarkdownFrontmatter } from '@/lib/markdown-frontmatter-boundary'
import { parseWikiLinks } from '@/lib/wiki-links'

function escapeLabel(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

// `MarkdownIt#render` is synchronous. The Worker asks for this one render
// mode while it builds a long preview, then MarkdownContent decorates only
// code and math blocks that enter the viewport. Keeping the switch scoped to
// one synchronous render avoids a second heavyweight Markdown parser instance.
let deferCodeHighlightForRender = false

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
  highlight(code: string, language: string): string {
    if (language.trim().toLowerCase() === 'mermaid') {
      const encodedSource = escapeLabel(encodeURIComponent(code))
      return `<figure class="markdown-mermaid" tabindex="0" data-mermaid-source="${encodedSource}" data-mermaid-state="idle" aria-busy="false" aria-label="Mermaid 图表；滚动到此处加载，右键或 Shift 加 F10 可打开图表菜单"><figcaption>MERMAID · 图表</figcaption><div class="markdown-mermaid__canvas"></div><pre class="markdown-mermaid__source"><code>${escapeLabel(code)}</code></pre></figure>`
    }
    const label = escapeLabel(language || 'text')
    if (deferCodeHighlightForRender) {
      return `<div class="code-frame" data-code-highlight-state="idle" aria-busy="false"><div class="code-frame__bar"><span>${label}</span></div><pre class="code-block"><code data-deferred-code-language="${label}">${escapeLabel(code)}</code></pre></div>`
    }
    const safe = highlightCode(code, language)
    return `<div class="code-frame"><div class="code-frame__bar"><span>${label}</span></div><pre class="code-block"><code>${safe}</code></pre></div>`
  }
})

md.inline.ruler.before('escape', 'math_inline', (state: any, silent: boolean) => {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false
  let end = state.pos + 1
  while ((end = state.src.indexOf('$', end)) !== -1) {
    if (state.src[end - 1] !== '\\' && !state.src.slice(state.pos + 1, end).includes('\n')) break
    end += 1
  }
  if (end === -1) return false
  if (!silent) {
    const token = state.push('math_inline', 'math', 0)
    token.content = state.src.slice(state.pos + 1, end)
  }
  state.pos = end + 1
  return true
})

md.block.ruler.before('fence', 'math_block', (state: any, startLine: number, endLine: number, silent: boolean) => {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const maximum = state.eMarks[startLine]
  if (state.src.slice(start, maximum).trim() !== '$$') return false
  let nextLine = startLine + 1
  const body: string[] = []
  for (; nextLine < endLine; nextLine += 1) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
    const lineEnd = state.eMarks[nextLine]
    if (state.src.slice(lineStart, lineEnd).trim() === '$$') break
    body.push(state.src.slice(lineStart, lineEnd))
  }
  if (nextLine >= endLine) return false
  if (!silent) {
    const token = state.push('math_block', 'math', 0)
    token.block = true
    token.content = body.join('\n')
    token.map = [startLine, nextLine + 1]
  }
  state.line = nextLine + 1
  return true
})

md.renderer.rules.math_inline = (tokens: any[], index: number) => {
  const source = tokens[index].content.trim()
  if (!deferCodeHighlightForRender) return katex.renderToString(source, { throwOnError: false })
  return `<span class="math-inline" data-deferred-math="${escapeLabel(encodeURIComponent(source))}" data-math-display="false" data-math-state="idle" aria-busy="false">$${escapeLabel(source)}$</span>`
}
md.renderer.rules.math_block = (tokens: any[], index: number) => {
  const source = tokens[index].content.trim()
  if (!deferCodeHighlightForRender) return `<div class="math-block">${katex.renderToString(source, { displayMode: true, throwOnError: false })}</div>`
  return `<div class="math-block" data-deferred-math="${escapeLabel(encodeURIComponent(source))}" data-math-display="true" data-math-state="idle" aria-busy="false">$$${escapeLabel(source)}$$</div>`
}

// Wiki links stay standard, portable Markdown text on disk. The preview turns
// only plain text occurrences into interactive anchors, never code spans or
// normal Markdown links, so external files keep their original source intact.
md.core.ruler.after('inline', 'wiki_links', (state: any) => {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== 'inline' || !blockToken.children) continue
    const children: any[] = []
    let linkDepth = 0
    for (const token of blockToken.children) {
      if (token.type === 'link_open') { linkDepth += 1; children.push(token); continue }
      if (token.type === 'link_close') { linkDepth = Math.max(0, linkDepth - 1); children.push(token); continue }
      if (token.type !== 'text' || !token.content.includes('[[') || linkDepth) { children.push(token); continue }
      const links = parseWikiLinks(token.content)
      if (!links.length) { children.push(token); continue }
      let cursor = 0
      for (const link of links) {
        if (link.start > cursor) {
          const text = new state.Token('text', '', 0)
          text.content = token.content.slice(cursor, link.start)
          children.push(text)
        }
        const wiki = new state.Token('wiki_link', 'a', 0)
        wiki.meta = link
        children.push(wiki)
        cursor = link.end
      }
      if (cursor < token.content.length) {
        const text = new state.Token('text', '', 0)
        text.content = token.content.slice(cursor)
        children.push(text)
      }
    }
    blockToken.children = children
  }
})

md.renderer.rules.wiki_link = (tokens: any[], index: number) => {
  const link = tokens[index].meta as { target: string; heading?: string; label: string }
  const target = encodeURIComponent(link.target)
  const heading = link.heading ? encodeURIComponent(link.heading) : ''
  const title = link.heading ? `${link.target} · ${link.heading}` : link.target
  return `<a class="markdown-wiki-link" href="#wiki-${target}" data-wiki-target="${target}"${heading ? ` data-wiki-heading="${heading}"` : ''} title="打开知识库：${escapeLabel(title)}">${escapeLabel(link.label)}</a>`
}

// Notes often contain short formula fragments without explicit `$...$` delimiters.
// Convert only isolated algebra-style scripts so identifiers such as snake_case and
// code tokens keep their original Markdown meaning.
const implicitScriptPattern = /(?<![A-Za-z0-9_])((?:[A-Za-z]|\d+(?:\.\d+)?)(?:(?:\^(?:\{[^{}\n]+\}|[A-Za-z0-9+\-]))|(?:_(?:\{[^{}\n]+\}|[A-Za-z0-9+\-])))+)(?![A-Za-z0-9_])/g

md.core.ruler.after('inline', 'implicit_math_scripts', (state: any) => {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== 'inline' || !blockToken.children) continue
    const children: any[] = []
    for (const token of blockToken.children) {
      if (token.type !== 'text' || (!token.content.includes('^') && !token.content.includes('_'))) {
        children.push(token)
        continue
      }
      let cursor = 0
      implicitScriptPattern.lastIndex = 0
      for (const match of token.content.matchAll(implicitScriptPattern)) {
        const index = match.index ?? 0
        if (index > cursor) {
          const text = new state.Token('text', '', 0)
          text.content = token.content.slice(cursor, index)
          children.push(text)
        }
        const math = new state.Token('math_inline', 'math', 0)
        math.content = match[1]
        children.push(math)
        cursor = index + match[0].length
      }
      if (cursor < token.content.length) {
        const text = new state.Token('text', '', 0)
        text.content = token.content.slice(cursor)
        children.push(text)
      }
    }
    blockToken.children = children
  }
})

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens: any[], index: number, options: any, _env: any, self: any) => self.renderToken(tokens, index, options))
md.renderer.rules.link_open = (tokens: any[], index: number, options: any, env: any, self: any) => {
  tokens[index].attrJoin('class', 'markdown-standard-link')
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noreferrer noopener')
  return defaultLinkOpen(tokens, index, options, env, self)
}

const defaultImage = md.renderer.rules.image ?? ((tokens: any[], index: number, options: any, _env: any, self: any) => self.renderToken(tokens, index, options))
md.renderer.rules.image = (tokens: any[], index: number, options: any, env: any, self: any) => {
  tokens[index].attrSet('loading', 'lazy')
  tokens[index].attrSet('decoding', 'async')
  return defaultImage(tokens, index, options, env, self)
}

export function renderMarkdown(source: string) {
  return md.render(stripMarkdownFrontmatter(source))
    .replace(/<li>\[([ xX])\]\s+/g, (_match: string, checked: string) => `<li class="task-list-item"><input type="checkbox" disabled${checked.toLowerCase() === 'x' ? ' checked' : ''} aria-hidden="true">`)
    .replace(/<ul>\s*<li class="task-list-item">/g, '<ul class="task-list"><li class="task-list-item">')
}

export function renderMarkdownDeferredCode(source: string) {
  const previous = deferCodeHighlightForRender
  deferCodeHighlightForRender = true
  try {
    return renderMarkdown(source)
  } finally {
    deferCodeHighlightForRender = previous
  }
}

// Preview rendering is deliberately bounded: keeping a few recently rendered
// documents avoids reparsing unchanged content when users switch modes, while
// avoiding an ever-growing cache for a long-lived desktop session.
const previewCache = new Map<string, string>()
const PREVIEW_CACHE_LIMIT = 12
const PREVIEW_CACHE_BYTES = 8 * 1024 * 1024
const MAX_CACHED_SOURCE_LENGTH = 320 * 1024
const INCREMENTAL_PREVIEW_MIN_LENGTH = 48 * 1024
// The 5 MB performance fixture contains 722 safe heading sections. The count
// remains bounded, but needs to cover a genuinely long technical note so one
// small edit can reuse its unchanged rendered neighbors.
const INCREMENTAL_PREVIEW_MAX_BLOCKS = 800
const INCREMENTAL_BLOCK_CACHE_LIMIT = 800
const INCREMENTAL_BLOCK_CACHE_BYTES = 12 * 1024 * 1024
const incrementalBlockCache = new Map<string, string>()
let incrementalBlockCacheBytes = 0
let previewCacheBytes = 0

// JavaScript strings are UTF-16 sequences. Count their conservative in-memory
// footprint rather than code units so these cache budgets stay meaningful for
// Chinese-heavy notes as well as ASCII source code.
function cachedStringBytes(value: string) {
  return value.length * 2
}

function previewCacheKey(source: string) {
  // A sampled key is quicker, but can incorrectly reuse a preview when an
  // edit lands between sample points in a long note. Markdown parsing and
  // syntax highlighting already dominate the cost; a complete O(n) key is a
  // small, predictable cost (normally paid in the preview Worker) for exact
  // invalidation. Two directional FNV streams make accidental collisions
  // vanishingly unlikely without retaining another full source string.
  let forward = 2166136261
  let backward = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    forward ^= source.charCodeAt(index)
    forward = Math.imul(forward, 16777619)
    backward ^= source.charCodeAt(source.length - index - 1)
    backward = Math.imul(backward, 16777619)
  }
  return `${source.length}:${forward >>> 0}:${backward >>> 0}`
}

function cacheIncrementalBlock(key: string, html: string) {
  const previous = incrementalBlockCache.get(key)
  if (previous !== undefined) {
    incrementalBlockCache.delete(key)
    incrementalBlockCacheBytes -= cachedStringBytes(key) + cachedStringBytes(previous)
  }
  incrementalBlockCache.set(key, html)
  incrementalBlockCacheBytes += cachedStringBytes(key) + cachedStringBytes(html)
  while (incrementalBlockCache.size > INCREMENTAL_BLOCK_CACHE_LIMIT || incrementalBlockCacheBytes > INCREMENTAL_BLOCK_CACHE_BYTES) {
    const oldest = incrementalBlockCache.entries().next().value as [string, string] | undefined
    if (!oldest) break
    incrementalBlockCache.delete(oldest[0])
    incrementalBlockCacheBytes -= cachedStringBytes(oldest[0]) + cachedStringBytes(oldest[1])
  }
}

function cachePreview(key: string, html: string) {
  const previous = previewCache.get(key)
  if (previous !== undefined) {
    previewCache.delete(key)
    previewCacheBytes -= cachedStringBytes(key) + cachedStringBytes(previous)
  }
  previewCache.set(key, html)
  previewCacheBytes += cachedStringBytes(key) + cachedStringBytes(html)
  while (previewCache.size > PREVIEW_CACHE_LIMIT || previewCacheBytes > PREVIEW_CACHE_BYTES) {
    const oldest = previewCache.entries().next().value as [string, string] | undefined
    if (!oldest) break
    previewCache.delete(oldest[0])
    previewCacheBytes -= cachedStringBytes(oldest[0]) + cachedStringBytes(oldest[1])
  }
}

/**
 * Rendering complete Markdown sections independently is safe only at an
 * unindented ATX heading: it always closes the preceding top-level block.
 * Reference-style links resolve across the document, so those intentionally
 * take the exact full-document route instead of risking a different preview.
 */
export function splitMarkdownPreviewBlocks(source: string) {
  if (source.length < INCREMENTAL_PREVIEW_MIN_LENGTH || /^(?: {0,3})\[[^\]\n]+\]:/m.test(source)) return undefined

  const boundaries = [0]
  let lineStart = 0
  let fence: '`' | '~' | undefined
  let fenceLength = 0
  while (lineStart < source.length) {
    const lineEnd = source.indexOf('\n', lineStart)
    const end = lineEnd < 0 ? source.length : lineEnd
    const line = source.slice(lineStart, end)
    const fenceStart = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence) {
      const closingFence = fenceStart && /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/.test(line)
      if (closingFence && fenceStart[1][0] === fence && fenceStart[1].length >= fenceLength) {
        fence = undefined
        fenceLength = 0
      }
    } else if (fenceStart) {
      fence = fenceStart[1][0] as '`' | '~'
      fenceLength = fenceStart[1].length
    } else if (/^#{1,6}(?:\s|$)/.test(line) && lineStart > 0) {
      boundaries.push(lineStart)
    }
    lineStart = end + 1
  }

  if (fence || boundaries.length < 2 || boundaries.length > INCREMENTAL_PREVIEW_MAX_BLOCKS) return undefined
  const rawBlocks = boundaries.map((start, index) => source.slice(start, boundaries[index + 1] ?? source.length))
  // Tiny top-level fragments add more hash/cache work than they save. Merge
  // them into a neighbor instead of rejecting the whole document: a common
  // real note starts with only `# Title` before its first substantial section.
  // Repeated generated micro-headings still collapse to one block and safely
  // take the exact full-document path.
  const blocks: string[] = []
  for (const block of rawBlocks) {
    if (block.length < 96 && blocks.length) blocks[blocks.length - 1] += block
    else blocks.push(block)
  }
  if (blocks.length > 1 && (blocks[0]?.length ?? 0) < 96) {
    blocks[1] = `${blocks[0]}${blocks[1]}`
    blocks.shift()
  }
  return blocks.length > 1 ? blocks : undefined
}

export function renderMarkdownBlocksCached(source: string, deferCodeHighlight = false) {
  const blocks = splitMarkdownPreviewBlocks(source)
  if (!blocks) return undefined
  const mode = deferCodeHighlight ? 'deferred' : 'complete'
  return blocks.map((block) => {
    const key = `${mode}:block:${previewCacheKey(block)}`
    const cached = incrementalBlockCache.get(key)
    if (cached !== undefined) {
      // Map insertion order is our LRU order. Refresh on use without changing
      // retained bytes, so stable sections survive nearby edits.
      incrementalBlockCache.delete(key)
      incrementalBlockCache.set(key, cached)
      return cached
    }
    const html = deferCodeHighlight ? renderMarkdownDeferredCode(block) : renderMarkdown(block)
    cacheIncrementalBlock(key, html)
    return html
  })
}

function renderMarkdownIncremental(source: string, deferCodeHighlight: boolean) {
  return renderMarkdownBlocksCached(source, deferCodeHighlight)?.join('')
}

export function renderMarkdownCached(source: string, deferCodeHighlight = false) {
  // For a long source, prefer bounded section reuse before falling back to an
  // exact full render. This deliberately runs in the preview Worker; it keeps
  // a small edit from reparsing hundreds of unchanged sections without keeping
  // an unbounded complete-document HTML cache.
  if (source.length > MAX_CACHED_SOURCE_LENGTH) {
    return renderMarkdownIncremental(source, deferCodeHighlight)
      ?? (deferCodeHighlight ? renderMarkdownDeferredCode(source) : renderMarkdown(source))
  }
  const key = `${deferCodeHighlight ? 'deferred' : 'complete'}:${previewCacheKey(source)}`
  const existing = previewCache.get(key)
  if (existing !== undefined) {
    previewCache.delete(key)
    previewCache.set(key, existing)
    return existing
  }
  const html = renderMarkdownIncremental(source, deferCodeHighlight)
    ?? (deferCodeHighlight ? renderMarkdownDeferredCode(source) : renderMarkdown(source))
  cachePreview(key, html)
  return html
}
