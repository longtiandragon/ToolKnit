import { describe, expect, it } from 'vitest'
import { questionSourceActionLabel, questionSourceMarkdown, questionSourceReference } from './question-source'

describe('question source provenance', () => {
  it('keeps ordinary provenance as readable non-actionable text', () => {
    expect(questionSourceReference('LeetCode 704 · 教材第 7 章')).toMatchObject({ kind: 'text', label: 'LeetCode 704 · 教材第 7 章' })
    expect(questionSourceMarkdown('课程 [讲义]')).toBe('> 来源：课程 \\[讲义\\]')
  })

  it('recognizes direct, labelled and Markdown web sources', () => {
    expect(questionSourceReference('https://leetcode.cn/problems/binary-search/')).toMatchObject({ kind: 'web', href: 'https://leetcode.cn/problems/binary-search/' })
    expect(questionSourceReference('LeetCode 704：https://leetcode.cn/problems/binary-search/。')).toMatchObject({ kind: 'web', label: 'LeetCode 704', href: 'https://leetcode.cn/problems/binary-search/' })
    const markdown = questionSourceReference('[课程题单](https://example.com/list)')
    expect(markdown).toMatchObject({ kind: 'web', label: '课程题单', href: 'https://example.com/list' })
    expect(questionSourceActionLabel(markdown)).toBe('打开来源网页')
  })

  it('distinguishes local Markdown and ordinary files', () => {
    expect(questionSourceReference('F:\\Notes\\算法\\二分.md')).toMatchObject({ kind: 'markdown', path: 'F:\\Notes\\算法\\二分.md' })
    expect(questionSourceReference('F:\\Courses\\chapter-7.pdf')).toMatchObject({ kind: 'file', path: 'F:\\Courses\\chapter-7.pdf' })
    expect(questionSourceReference('./relative.md')).toMatchObject({ kind: 'text' })
  })

  it('never turns dangerous or non-browsing schemes into actions', () => {
    expect(questionSourceReference('javascript:alert(1)')).toMatchObject({ kind: 'text' })
    expect(questionSourceReference('mailto:student@example.com')).toMatchObject({ kind: 'text' })
    expect(questionSourceReference('data:text/html,hello')).toMatchObject({ kind: 'text' })
  })

  it('emits a safe clickable review citation for actionable sources', () => {
    expect(questionSourceMarkdown('LeetCode 704：https://leetcode.cn/problems/binary-search/')).toBe('> 来源：[LeetCode 704](https://leetcode.cn/problems/binary-search/)')
  })
})
