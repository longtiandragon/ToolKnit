import { describe, expect, it } from 'vitest'
import { parseMarkdownFrontmatter } from './markdown-frontmatter'
import { questionTemplate } from './question-template'

describe('questionTemplate', () => {
  it('keeps structured question metadata consistent with its Markdown properties', () => {
    const markdown = questionTemplate('为什么 a: b？', { questionType: 'general', subject: '计算机', tags: ['网络', '边界'], difficulty: 4, reviewEnabled: false })
    const frontmatter = parseMarkdownFrontmatter(markdown)
    expect(frontmatter?.json).toMatchObject({ title: '为什么 a: b？', type: 'general', subject: '计算机', tags: ['网络', '边界'], difficulty: 4, review_enabled: false })
  })
})
