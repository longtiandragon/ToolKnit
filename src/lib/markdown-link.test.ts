import { describe, expect, it } from 'vitest'
import { classifyMarkdownLink, markdownHeadingMatchesFragment, markdownLinkMarkup, resolveMarkdownRelativePath } from './markdown-link'

describe('Markdown link workflow', () => {
  it('classifies safe web, mail and same-document targets without allowing script URLs', () => {
    expect(classifyMarkdownLink('https://example.com/guide?q=1#intro')).toEqual({ kind: 'external', href: 'https://example.com/guide?q=1#intro' })
    expect(classifyMarkdownLink('//example.com/reference')).toEqual({ kind: 'external', href: 'https://example.com/reference' })
    expect(classifyMarkdownLink('mailto:student@example.com')).toEqual({ kind: 'external', href: 'mailto:student@example.com' })
    expect(classifyMarkdownLink('#边界条件')).toEqual({ kind: 'anchor', fragment: '边界条件' })
    expect(classifyMarkdownLink('javascript:alert(1)')).toEqual({ kind: 'unsupported', href: 'javascript:alert(1)' })
  })

  it('resolves portable Markdown and attachment paths relative to the current file', () => {
    const base = 'F:\\Notes\\算法\\二分.md'
    expect(resolveMarkdownRelativePath(base, '../公共/循环不变量.md')).toBe('F:\\Notes\\公共\\循环不变量.md')
    expect(classifyMarkdownLink('../公共/循环不变量.md#证明', base)).toEqual({ kind: 'markdown', path: 'F:\\Notes\\公共\\循环不变量.md', fragment: '证明' })
    expect(classifyMarkdownLink('./assets/示意图%201.png', base)).toEqual({ kind: 'file', path: 'F:\\Notes\\算法\\assets\\示意图 1.png' })
  })

  it('supports absolute Windows and file URLs while leaving unbased relative links unresolved', () => {
    expect(classifyMarkdownLink('C:\\Vault\\README.md')).toEqual({ kind: 'markdown', path: 'C:\\Vault\\README.md' })
    expect(classifyMarkdownLink('file:///C:/Vault/diagram.png')).toEqual({ kind: 'file', path: 'C:\\Vault\\diagram.png' })
    expect(classifyMarkdownLink('./other.md')).toEqual({ kind: 'unresolved-relative', href: './other.md' })
  })

  it('copies a portable Markdown reference and matches common heading fragments', () => {
    expect(markdownLinkMarkup('边界 [证明]', './guide (final).md')).toBe('[边界 \\[证明\\]](./guide \\(final\\).md)')
    expect(markdownHeadingMatchesFragment('循环不变量：证明', '循环不变量-证明')).toBe(true)
    expect(markdownHeadingMatchesFragment('复杂度分析', '边界条件')).toBe(false)
  })
})
