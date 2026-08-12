import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, RICH_CLIPBOARD_HTML_LIMIT, RICH_CLIPBOARD_MARKDOWN_LIMIT } from './html-to-markdown'

describe('HTML clipboard to Markdown', () => {
  it('keeps headings, emphasis, links and paragraphs', () => {
    expect(htmlToMarkdown('<h2>课程 <strong>重点</strong></h2><p>阅读 <a href="https://example.com/a(b)">资料</a>。</p>')).toEqual({
      markdown: '## 课程 **重点**\n\n阅读 [资料](https://example.com/a\\(b\\))。',
      truncated: false,
      rich: true,
    })
  })

  it('converts lists, quotes, code blocks and tables', () => {
    const result = htmlToMarkdown('<ol><li>第一项</li><li><b>第二项</b></li></ol><blockquote>结论<br>下一行</blockquote><pre><code class="language-ts">const n = 1</code></pre><table><tr><th>词</th><th>释义</th></tr><tr><td>run</td><td>跑</td></tr></table>')
    expect(result.markdown).toContain('1. 第一项\n2. **第二项**')
    expect(result.markdown).toContain('> 结论\n> 下一行')
    expect(result.markdown).toContain('```ts\nconst n = 1\n```')
    expect(result.markdown).toContain('| 词 | 释义 |\n| --- | --- |\n| run | 跑 |')
  })

  it('drops executable content and unsafe targets', () => {
    const result = htmlToMarkdown('<p onclick="bad()">安全<script>alert(1)</script><a href="javascript:alert(1)">链接</a><a href="custom:run">动作</a><img src="file:///secret.png" alt="secret"><img src="data:image/png;base64,AAAA" alt="large"></p>')
    expect(result.markdown).toBe('安全链接动作')
    expect(result.markdown).not.toContain('alert')
    expect(result.markdown).not.toContain('secret')
    expect(result.markdown).not.toContain('base64')
  })

  it('decodes entities and escapes Markdown punctuation from ordinary text', () => {
    expect(htmlToMarkdown('<p>A &amp; B * [draft] &#x4E2D;</p>').markdown).toBe('A & B \\* \\[draft\\] 中')
  })

  it('reports bounded conversion work', () => {
    const oversized = `<p>${'x'.repeat(RICH_CLIPBOARD_HTML_LIMIT + 20)}</p>`
    const result = htmlToMarkdown(oversized)
    expect(result.truncated).toBe(true)
    expect(result.markdown.length).toBeLessThanOrEqual(RICH_CLIPBOARD_MARKDOWN_LIMIT)
  })

  it('does not claim that plain wrapper HTML contains rich formatting', () => {
    expect(htmlToMarkdown('<span>plain</span>').rich).toBe(false)
  })
})
