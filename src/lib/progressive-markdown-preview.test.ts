import { describe, expect, it } from 'vitest'
import { markdownPreviewProgress, nextMarkdownPreviewBatch } from './progressive-markdown-preview'

describe('progressive Markdown preview batching', () => {
  it('keeps a normal DOM turn within both section and character budgets', () => {
    const blocks = Array.from({ length: 30 }, (_, index) => `${index}`.padEnd(20, '.'))
    const batch = nextMarkdownPreviewBatch(blocks, 0, 100, 3)
    expect(batch).toEqual({ html: blocks.slice(0, 3).join(''), start: 0, end: 3 })
  })

  it('always advances past one oversized section', () => {
    const blocks = ['x'.repeat(200), 'next']
    const batch = nextMarkdownPreviewBatch(blocks, 0, 32, 4)
    expect(batch?.end).toBe(1)
    expect(batch?.html).toHaveLength(200)
  })

  it('can rebuild the exact Worker output without dropping or reordering sections', () => {
    const blocks = Array.from({ length: 41 }, (_, index) => `<section>${index}</section>`)
    const mounted: string[] = []
    let index = 0
    while (index < blocks.length) {
      const batch = nextMarkdownPreviewBatch(blocks, index, 90, 5)
      expect(batch).toBeDefined()
      mounted.push(batch!.html)
      index = batch!.end
    }
    expect(mounted.join('')).toBe(blocks.join(''))
    expect(markdownPreviewProgress(index, blocks.length)).toBe(100)
  })
})
