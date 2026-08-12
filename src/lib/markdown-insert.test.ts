import { describe, expect, it } from 'vitest'
import { createMarkdownFormula, createMarkdownTable, placeMarkdownBlock } from './markdown-insert'

describe('Markdown structured insertions', () => {
  it('creates a bounded portable table and selects its first editable header', () => {
    const table = createMarkdownTable({ columns: 3, rows: 2, alignment: 'center' })
    expect(table.text).toBe('| 列 1 | 列 2 | 列 3 |\n| :---: | :---: | :---: |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |')
    expect(table.text.slice(table.selectionStart, table.selectionEnd)).toBe('列 1')

    const bounded = createMarkdownTable({ columns: 99, rows: 99 })
    expect(bounded.text.split('\n')).toHaveLength(14)
    expect(bounded.text.split('\n')[0].match(/\|/g)).toHaveLength(9)
  })

  it('supports an intentionally blank table header while selecting body content', () => {
    const table = createMarkdownTable({ columns: 2, rows: 1, fillHeader: false, alignment: 'right' })
    expect(table.text).toBe('|  |  |\n| ---: | ---: |\n| 内容 | 内容 |')
    expect(table.text.slice(table.selectionStart, table.selectionEnd)).toBe('内容')
  })

  it('normalizes existing formula delimiters and keeps the source selected', () => {
    expect(createMarkdownFormula('$a+b$', 'inline')).toEqual({ text: '$a+b$', selectionStart: 1, selectionEnd: 4 })
    const block = createMarkdownFormula('$$\n\\frac{a}{b}\n$$', 'block')
    expect(block.text).toBe('$$\n\\frac{a}{b}\n$$')
    expect(block.text.slice(block.selectionStart, block.selectionEnd)).toBe('\\frac{a}{b}')
  })

  it('adds block spacing only where the surrounding document needs it', () => {
    const insertion = { text: '| A |\n| --- |\n| B |', selectionStart: 2, selectionEnd: 3 }
    expect(placeMarkdownBlock('前文后文', 2, 2, insertion)).toEqual({
      text: '\n\n| A |\n| --- |\n| B |\n\n',
      selectionStart: 4,
      selectionEnd: 5,
    })
    expect(placeMarkdownBlock('前文\n\n后文', 4, 4, insertion).text).toBe('| A |\n| --- |\n| B |\n\n')
  })
})
