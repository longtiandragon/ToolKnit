import { describe, expect, it } from 'vitest'
import { markdownFrontmatterBlock, parseMarkdownFrontmatter, stripMarkdownFrontmatter } from './markdown-frontmatter'

describe('Markdown Frontmatter', () => {
  it('parses common Obsidian properties without changing the source body', () => {
    const source = '---\ntags: [算法, 图论]\ndraft: false\nweight: 3\naliases:\n  - 最短路\n---\n# Dijkstra\n\n正文'
    const result = parseMarkdownFrontmatter(source)
    expect(result?.entries).toEqual([
      { key: 'tags', summary: '算法 · 图论', kind: 'list' },
      { key: 'draft', summary: '否', kind: 'boolean' },
      { key: 'weight', summary: '3', kind: 'number' },
      { key: 'aliases', summary: '最短路', kind: 'list' },
    ])
    expect(stripMarkdownFrontmatter(source)).toBe('# Dijkstra\n\n正文')
    expect(source).toContain('tags: [算法, 图论]')
  })

  it('supports a BOM, CRLF and the YAML document terminator', () => {
    const source = '\ufeff---\r\ntitle: 保留\r\n...\r\n正文'
    const block = markdownFrontmatterBlock(source)
    expect(block?.yaml).toBe('title: 保留\r\n')
    expect(stripMarkdownFrontmatter(source)).toBe('正文')
  })

  it('keeps malformed or unterminated headers visible instead of hiding the note', () => {
    const malformed = '---\ntags: [没有结束\n---\n正文'
    expect(parseMarkdownFrontmatter(malformed)?.error).toContain('unexpected end of the stream')
    const unterminated = '---\ntitle: 仍是正文\n# 标题'
    expect(parseMarkdownFrontmatter(unterminated)).toBeUndefined()
    expect(stripMarkdownFrontmatter(unterminated)).toBe(unterminated)
  })

  it('bounds property summaries while retaining the complete raw YAML', () => {
    const properties = Array.from({ length: 45 }, (_, index) => `key${index}: value${index}`).join('\n')
    const source = `---\n${properties}\n---\n正文`
    const result = parseMarkdownFrontmatter(source)
    expect(result?.entries).toHaveLength(40)
    expect(result?.truncated).toBe(true)
    expect(result?.raw).toContain('key44: value44')
  })
})
