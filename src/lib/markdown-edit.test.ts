import { describe, expect, it } from 'vitest'
import { applyMarkdownCodeBlock, applyMarkdownEdit, markdownLinePrefixLength, markdownLineQueryRange } from './markdown-edit'

describe('Markdown edit commands', () => {
  it('selects the full phrase or longest matching term on a target line', () => {
    expect(markdownLineQueryRange('## 松弛操作', '松弛操作')).toEqual({ from: 3, to: 7 })
    expect(markdownLineQueryRange('## 松弛操作与优先队列', '松弛 操作')).toEqual({ from: 3, to: 5 })
    expect(markdownLineQueryRange('Dijkstra shortest path', 'SHORTEST')).toEqual({ from: 9, to: 17 })
    expect(markdownLineQueryRange('没有命中', '其他')).toBeUndefined()
  })

  it('wraps and unwraps inline emphasis without reading the surrounding document', () => {
    expect(applyMarkdownEdit('bold', '重点')).toEqual({ text: '**重点**', selectionStart: 2, selectionEnd: 4 })
    expect(applyMarkdownEdit('bold', '**重点**').text).toBe('重点')
    expect(applyMarkdownEdit('italic', '**保持粗体**').text).toBe('***保持粗体***')
  })

  it('creates an editable link and a collision-safe code fence', () => {
    expect(applyMarkdownEdit('link', '文档')).toEqual({ text: '[文档](https://)', selectionStart: 5, selectionEnd: 13 })
    const code = applyMarkdownEdit('code-block', '````ts\nconst answer = 42\n````')
    expect(code.text.startsWith('`````\n')).toBe(true)
    expect(code.text.endsWith('\n`````')).toBe(true)
  })

  it('toggles line prefixes for headings, quotes and lists', () => {
    expect(applyMarkdownEdit('heading-2', '# 标题').text).toBe('## 标题')
    expect(applyMarkdownEdit('heading-2', '## 标题').text).toBe('标题')
    expect(applyMarkdownEdit('quote', '第一行\n第二行').text).toBe('> 第一行\n> 第二行')
    expect(applyMarkdownEdit('bullet-list', '- 一\n- 二').text).toBe('一\n二')
    expect(applyMarkdownEdit('numbered-list', '一\n二').text).toBe('1. 一\n2. 二')
    expect(applyMarkdownEdit('task-list', '一\n二').text).toBe('- [ ] 一\n- [ ] 二')
    expect(applyMarkdownEdit('task-list', '- [x] 完成\n- [ ] 待办').text).toBe('完成\n待办')
    expect(markdownLinePrefixLength('numbered-list', '12. 内容')).toBe(4)
    expect(markdownLinePrefixLength('task-list', '- [ ] 内容')).toBe(6)
  })

  it('adds a language to a collision-safe fenced code block', () => {
    const result = applyMarkdownCodeBlock('const answer = 42', 'typescript')
    expect(result.text).toBe('```typescript\nconst answer = 42\n```')
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('const answer = 42')
  })
})
