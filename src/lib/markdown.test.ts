import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('highlights a registered language', () => {
    const html = renderMarkdown('```ts\nconst value: number = 1\n```')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('hljs-built_in')
  })

  it('escapes code for an unknown language', () => {
    expect(renderMarkdown('```unknown\n<a>\n```')).toContain('&lt;a&gt;')
  })

  it('renders inline math', () => {
    expect(renderMarkdown('结果是 $x^2$。')).toContain('katex')
  })
})
