import { describe, expect, it } from 'vitest'
import { nextAvailableNoteTitle, noteStarterTemplates, noteTemplateContent } from './note-template'

describe('note starter templates', () => {
  it('keeps the public learning flows distinct', () => {
    expect(noteStarterTemplates.map((template) => template.id)).toEqual(['algorithm', 'concept', 'english', 'mindmap', 'diagram'])
    expect(noteStarterTemplates.every((template) => template.subject && template.tags.length > 0)).toBe(true)
  })

  it('keeps visual creation portable inside Markdown', () => {
    const mindmap = noteStarterTemplates.find((template) => template.id === 'mindmap')!
    const diagram = noteStarterTemplates.find((template) => template.id === 'diagram')!

    expect(noteTemplateContent(mindmap)).toContain('### 分支一')
    expect(noteTemplateContent(diagram)).toContain('~~~mermaid')
    expect(noteTemplateContent(diagram)).toContain('flowchart LR')
  })

  it('creates portable Markdown with the chosen title', () => {
    const algorithm = noteStarterTemplates[0]
    const source = noteTemplateContent(algorithm, '二分边界')

    expect(source.startsWith('# 二分边界\n')).toBe(true)
    expect(source).toContain('## 正确性 / 不变量')
    expect(source).toContain('~~~ts')
    expect(source).toContain('[[相关知识点]]')
  })

  it('keeps template titles usable as unique wiki-link targets', () => {
    expect(nextAvailableNoteTitle('算法记录', ['算法记录', '算法记录 2', '概念笔记'])).toBe('算法记录 3')
    expect(nextAvailableNoteTitle('  算法记录  ', ['算法记录'])).toBe('算法记录 2')
  })
})
