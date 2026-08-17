import { describe, expect, it } from 'vitest'
import { extractWebArticle, htmlToMarkdown, RICH_CLIPBOARD_HTML_LIMIT, RICH_CLIPBOARD_MARKDOWN_LIMIT } from './html-to-markdown'

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

describe('offline web article extraction', () => {
  it('prefers the semantic article and removes page chrome', () => {
    const result = extractWebArticle(`<!doctype html><html><head><title>站点标题</title><meta property="og:title" content="真正的文章"><meta property="og:site_name" content="示例站"><meta name="author" content="林同学"></head><body><nav>${'<a href="/x">栏目</a>'.repeat(30)}</nav><article><h1>真正的文章</h1><p>这是第一段正文，包含足够的信息来判断文章的主要内容，而不是网站导航。</p><p>这是第二段正文，用来验证正文段落会被完整保留下来。</p><aside>相关文章推荐</aside></article><section class="comments">评论区噪声</section></body></html>`)
    expect(result.title).toBe('真正的文章')
    expect(result.siteName).toBe('示例站')
    expect(result.byline).toBe('林同学')
    expect(result.markdown).toContain('# 真正的文章')
    expect(result.markdown).toContain('这是第一段正文')
    expect(result.markdown).not.toContain('栏目')
    expect(result.markdown).not.toContain('相关文章推荐')
    expect(result.markdown).not.toContain('评论区噪声')
    expect(result.confidence).not.toBe('low')
  })

  it('recognizes content containers without requiring an article tag', () => {
    const result = extractWebArticle('<html><body><header>网站头部</header><div class="post-content"><h1>课程总结</h1><p>第一部分解释课程背景以及需要完成的目标。</p><p>第二部分给出实际结论和后续安排。</p></div><footer>版权信息</footer></body></html>')
    expect(result.title).toBe('课程总结')
    expect(result.markdown).toContain('第一部分')
    expect(result.markdown).not.toContain('网站头部')
    expect(result.markdown).not.toContain('版权信息')
    expect(result.confidence).toBe('medium')
  })

  it('falls back transparently for pages without a strong article container', () => {
    const result = extractWebArticle('<html><head><title>零散页面</title></head><body><header>站点菜单</header><p>只有一小段可读内容。</p><div class="cookie-consent">接受 Cookie</div></body></html>')
    expect(result.title).toBe('零散页面')
    expect(result.markdown).toBe('只有一小段可读内容。')
    expect(result.confidence).toBe('low')
    expect(result.removedBlocks).toBeGreaterThanOrEqual(2)
  })

  it('keeps extraction bounded and drops executable or unsafe content', () => {
    const result = extractWebArticle(`<article><h1>安全正文</h1><p>${'x'.repeat(RICH_CLIPBOARD_HTML_LIMIT + 50)}</p><script>alert(1)</script><a href="javascript:bad()">继续阅读</a></article>`)
    expect(result.truncated).toBe(true)
    expect(result.markdown.length).toBeLessThanOrEqual(RICH_CLIPBOARD_MARKDOWN_LIMIT)
    expect(result.markdown).not.toContain('alert')
    expect(result.markdown).not.toContain('javascript')
  })
})
