import { describe, expect, it } from 'vitest'
import { analyzeMarkdownStatistics, markdownStatisticsSummary } from './markdown-statistics'

describe('Markdown statistics', () => {
  it('counts mixed Chinese, Latin words, paragraphs and headings', () => {
    const result = analyzeMarkdownStatistics('# 算法 Notes\n\n二分 search-boundary 42。\n')
    expect(result).toMatchObject({ cjkCharacters: 4, latinWords: 3, paragraphs: 2, headings: 1, lines: 4 })
    expect(result.readingMinutes).toBe(1)
  })

  it('counts fenced body lines without treating code headings as headings', () => {
    const result = analyzeMarkdownStatistics('## 正文\n\n```ts\n# not a title\nconst n = 1\n```\n')
    expect(result.headings).toBe(1)
    expect(result.codeLines).toBe(2)
  })

  it('normalizes Windows line endings and handles an empty document honestly', () => {
    expect(analyzeMarkdownStatistics('a\r\nb').lines).toBe(2)
    expect(analyzeMarkdownStatistics('')).toMatchObject({ charactersWithSpaces: 0, paragraphs: 0, lines: 0, readingMinutes: 0 })
  })

  it('formats a copyable local summary', () => {
    const summary = markdownStatisticsSummary(analyzeMarkdownStatistics('中文 text'))
    expect(summary).toContain('Knitspace Markdown 统计')
    expect(summary).toContain('中文字符：2')
    expect(summary).toContain('英文/数字词：1')
  })
})
