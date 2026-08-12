import { describe, expect, it } from 'vitest'
import { markdownSelectionTitle } from './markdown-selection'

describe('markdownSelectionTitle', () => {
  it('uses the first visible Markdown line without its block marker', () => {
    expect(markdownSelectionTitle('\n\n## 二分查找的边界\n后续内容')).toBe('二分查找的边界')
    expect(markdownSelectionTitle('> **需要复盘的结论**')).toBe('需要复盘的结论')
  })

  it('falls back for blank selections and bounds long titles', () => {
    expect(markdownSelectionTitle(' \n ', '选区笔记')).toBe('选区笔记')
    expect(markdownSelectionTitle('abcdefghijklmnopqrstuvwxyz', 'fallback', 10)).toBe('abcdefghi…')
  })
})
