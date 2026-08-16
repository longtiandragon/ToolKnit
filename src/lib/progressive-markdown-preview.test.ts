import { describe, expect, it } from 'vitest'
import { markdownPreviewProgress, nextMarkdownPreviewBatch, nextMarkdownPreviewBatchRange, planMarkdownPreviewReconciliation } from './progressive-markdown-preview'

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

  it('bounds a range without joining HTML the DOM caller does not need', () => {
    expect(nextMarkdownPreviewBatchRange(['aa', 'bbb', 'tail'], 0, 4, 12, 2)).toEqual({ start: 0, end: 1 })
    expect(nextMarkdownPreviewBatchRange(['aa', 'bbb', 'tail'], 1, 99, 12, 2)).toEqual({ start: 1, end: 2 })
  })

  it('reuses unchanged blocks around a small middle edit', () => {
    expect(planMarkdownPreviewReconciliation(
      ['intro', 'section-a', 'section-b', 'appendix'],
      ['intro', 'section-a edited', 'section-b', 'appendix'],
      true,
    )).toEqual({
      prefix: 1,
      suffix: 2,
      replaceStart: 1,
      previousReplaceEnd: 2,
      nextReplaceEnd: 2,
      fullReplace: false,
    })
  })

  it('falls back to a full progressive rebuild when DOM ranges are stale', () => {
    expect(planMarkdownPreviewReconciliation(['old'], ['new', 'tail'], false)).toMatchObject({
      prefix: 0,
      suffix: 0,
      previousReplaceEnd: 1,
      nextReplaceEnd: 2,
      fullReplace: true,
    })
  })
})
