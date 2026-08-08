import { describe, expect, it } from 'vitest'
import { buildRenamePreview, cleanOutputName, parsePageIndexes, transformText } from './file-tools'

describe('parsePageIndexes', () => {
  it('parses pages and ranges in the requested order', () => {
    expect(parsePageIndexes('3,1-2,5', 5)).toEqual([2, 0, 1, 4])
  })

  it.each(['0', '4-2', '1,abc', '6'])('rejects invalid range %s', (value) => {
    expect(() => parsePageIndexes(value, 5)).toThrow()
  })
})

describe('text transforms', () => {
  it('formats JSON', () => {
    expect(transformText('{"ok":true}', 'json')).toEqual({ content: '{\n  "ok": true\n}', extension: 'json' })
  })

  it('normalizes markdown blank lines', () => {
    expect(transformText('# 标题\r\n\r\n\r\n正文', 'markdown').content).toBe('# 标题\n\n正文\n')
  })
})

describe('file naming', () => {
  it('keeps Chinese characters in output names', () => {
    expect(cleanOutputName('课程 资料.pdf')).toBe('课程-资料')
  })

  it('creates stable rename previews', () => {
    expect(buildRenamePreview(['a.txt', '无扩展名'], '归档')).toEqual([
      'a.txt  →  归档-001.txt',
      '无扩展名  →  归档-002'
    ])
  })
})
