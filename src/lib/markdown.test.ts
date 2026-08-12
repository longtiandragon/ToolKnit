import { describe, expect, it } from 'vitest'
import { renderMarkdown, renderMarkdownBlocksCached, renderMarkdownCached, renderMarkdownDeferredCode, splitMarkdownPreviewBlocks } from './markdown'

describe('renderMarkdown', () => {
  it('highlights a registered language', () => {
    const html = renderMarkdown('```ts\nconst value: number = 1\n```')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('hljs-built_in')
  })

  it('can defer fenced-code highlighting without changing readable source', () => {
    const html = renderMarkdownDeferredCode('```ts\nconst visibleLater = true\n```')
    expect(html).toContain('data-deferred-code-language="ts"')
    expect(html).toContain('const visibleLater = true')
    expect(html).not.toContain('hljs-keyword')
  })

  it('can defer KaTeX while preserving readable inline and display source', () => {
    const html = renderMarkdownDeferredCode('行内 $x^2$\n\n$$\ny = mx + b\n$$')
    expect(html).toContain('data-deferred-math=')
    expect(html).toContain('$x^2$')
    expect(html).toContain('$$y = mx + b$$')
    expect(html).not.toContain('class="katex"')
  })

  it('escapes code for an unknown language', () => {
    expect(renderMarkdown('```unknown\n<a>\n```')).toContain('&lt;a&gt;')
  })

  it('keeps Mermaid source inert until the preview component reaches it', () => {
    const html = renderMarkdown('```mermaid\nflowchart LR\n  A[开始] --> B[完成]\n```')
    expect(html).toContain('class="markdown-mermaid"')
    expect(html).toContain('data-mermaid-source=')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('flowchart LR')
  })

  it('renders inline math', () => {
    expect(renderMarkdown('结果是 $x^2$。')).toContain('katex')
  })

  it('renders common superscript and subscript shorthand in notes', () => {
    const html = renderMarkdown('平方 x^2，下标 x_1，序列 a_n，表达式 x^{n+1}。')
    expect(html.match(/class="katex"/g)).toHaveLength(4)
    expect(html).toContain('msupsub')
  })

  it('does not reinterpret identifiers, emphasis, or inline code as math', () => {
    const html = renderMarkdown('保留 snake_case、_斜体_ 和 `x_1`。')
    expect(html).toContain('snake_case')
    expect(html).toContain('<em>斜体</em>')
    expect(html).toContain('<code>x_1</code>')
    expect(html).not.toContain('class="katex"')
  })

  it('renders display math without touching code spans', () => {
    const html = renderMarkdown('$$\nx^2 + y^2\n$$\n\n`$literal$`')
    expect(html).toContain('math-block')
    expect(html).toContain('$literal$')
  })

  it('renders task lists and safe external links', () => {
    const html = renderMarkdown('- [x] 完成\n- [ ] 待办\n\n[链接](https://example.com)')
    expect(html).toContain('task-list-item')
    expect(html).toContain('checked')
    expect(html).toContain('class="markdown-standard-link"')
    expect(html).toContain('rel="noreferrer noopener"')
  })

  it('keeps YAML Frontmatter out of reading preview while rendering its body', () => {
    const html = renderMarkdown('---\ntags: [算法, 图论]\ndraft: false\n---\n# Dijkstra\n\n正文')
    expect(html).toContain('<h1>Dijkstra</h1>')
    expect(html).toContain('<p>正文</p>')
    expect(html).not.toContain('tags:')
    expect(html).not.toContain('draft:')
  })

  it('renders wiki links as local navigation without changing code spans', () => {
    const html = renderMarkdown('关联 [[二分#边界|这条笔记]]，但保留 `[[不转链接]]`。')
    expect(html).toContain('class="markdown-wiki-link"')
    expect(html).toContain('data-wiki-target="%E4%BA%8C%E5%88%86"')
    expect(html).toContain('data-wiki-heading="%E8%BE%B9%E7%95%8C"')
    expect(html).toContain('<code>[[不转链接]]</code>')
  })

  it('reuses a bounded cached preview for unchanged Markdown', () => {
    const source = '# Markdown 性能\n\n```ts\nconst stable = true\n```'
    expect(renderMarkdownCached(source)).toBe(renderMarkdown(source))
    expect(renderMarkdownCached(source)).toContain('stable')
  })

  it('invalidates a cached long preview when an interior character changes', () => {
    // This deliberately changes a position beyond the old edge samples. The
    // preview must never display stale note content just to save a parse.
    const before = `# 长笔记\n\n${'a'.repeat(64_000)}旧结论${'b'.repeat(64_000)}`
    const after = before.replace('旧结论', '新结论')

    expect(renderMarkdownCached(before)).toContain('旧结论')
    expect(renderMarkdownCached(after)).toContain('新结论')
    expect(renderMarkdownCached(after)).not.toContain('旧结论')
  })

  it('reuses safe top-level sections without changing deferred Markdown output', () => {
    const stableSection = `## 稳定章节\n\n${'这段内容包含 [[知识网络]] 和 $x^2$。\n\n'.repeat(1_600)}`
    const source = `# 增量预览\n\n${'前言。\n'.repeat(11_000)}\n${stableSection}\n## 正在编辑\n\n${'尾部内容。\n'.repeat(1_600)}`
    const changed = source.replace('正在编辑', '已经编辑')

    expect(splitMarkdownPreviewBlocks(source)?.length).toBeGreaterThan(2)
    expect(renderMarkdownCached(source, true)).toBe(renderMarkdownDeferredCode(source))
    expect(renderMarkdownCached(changed, true)).toBe(renderMarkdownDeferredCode(changed))
    expect(renderMarkdownCached(changed, true)).toContain('已经编辑')
  })

  it('keeps a bounded section cache available for a document with hundreds of headings', () => {
    const sections = Array.from({ length: 720 }, (_, index) => (
      `## 第 ${index + 1} 节\n\n${'稳定段落与 [[知识网络]]。\n'.repeat(8)}`
    ))
    const source = `# 长文档\n\n${'这是一段真实文档前言，用于验证首段也适合独立渲染。\n'.repeat(8)}\n${sections.join('\n')}`
    const changed = source.replace('第 360 节', '第 360 节（已更新）')

    expect(splitMarkdownPreviewBlocks(source)).toHaveLength(721)
    expect(renderMarkdownBlocksCached(source, true)?.join('')).toBe(renderMarkdownDeferredCode(source))
    expect(renderMarkdownCached(source, true)).toBe(renderMarkdownDeferredCode(source))
    expect(renderMarkdownCached(changed, true)).toContain('第 360 节（已更新）')
  })

  it('merges a short document title into its first substantial preview section', () => {
    const sections = Array.from({ length: 8 }, (_, index) => `## 第 ${index + 1} 节\n\n${'足够长的正文。'.repeat(1_000)}\n`)
    const source = `# 短标题\n\n${sections.join('\n')}`
    const blocks = splitMarkdownPreviewBlocks(source)

    expect(blocks).toHaveLength(8)
    expect(blocks?.[0]).toContain('# 短标题')
    expect(blocks?.join('')).toBe(source)
    expect(renderMarkdownBlocksCached(source, true)?.join('')).toBe(renderMarkdownDeferredCode(source))
  })

  it('uses the exact whole-document parser when reference links cross a heading', () => {
    const source = `# 链接定义\n\n${'填充正文。\n'.repeat(10_000)}\n[文档]: https://example.com\n\n## 使用链接\n\n[打开文档][文档]`

    expect(splitMarkdownPreviewBlocks(source)).toBeUndefined()
    expect(renderMarkdownBlocksCached(source, true)).toBeUndefined()
    expect(renderMarkdownCached(source, true)).toBe(renderMarkdownDeferredCode(source))
  })
})
