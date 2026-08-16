import { describe, expect, it } from 'vitest'
import { calculateCodeLayout, codeLongImageFileNames, estimateCodeCapturePageBodyHeight, groupCodeCapturePages, joinCodePages } from './code-layout'

describe('calculateCodeLayout', () => {
  it('keeps an empty snippet exportable as one blank page', () => {
    expect(calculateCodeLayout('')).toMatchObject({ lineCount: 0, longestLine: 1, fontSize: 20, linesPerPage: 38, pages: [''], pageLineCounts: [1] })
  })

  it('measures Unicode safely and preserves the exact source across pages', () => {
    const source = Array.from({ length: 80 }, (_, index) => `// 第 ${index + 1} 行：😀 ${'x'.repeat(index % 12)}`).join('\n')
    const layout = calculateCodeLayout(source)
    expect(layout.lineCount).toBe(80)
    expect(layout.longestLine).toBeGreaterThan(10)
    expect(layout.pages.join('\n')).toBe(source)
    expect(layout.pageLineCounts.reduce((total, count) => total + count, 0)).toBe(80)
  })

  it('reduces text size and page height for very long lines', () => {
    const layout = calculateCodeLayout(`${'x'.repeat(240)}\nconst answer = 42`)
    expect(layout.fontSize).toBe(14)
    expect(layout.linesPerPage).toBe(22)
  })

  it('lays out a large snippet without losing lines or allocating per-line code-point arrays', () => {
    const source = Array.from({ length: 10_000 }, (_, index) => `const row${index} = '中文 😀 ${index}'`).join('\n')
    const layout = calculateCodeLayout(source)
    expect(layout.lineCount).toBe(10_000)
    expect(layout.pageLineCounts.reduce((total, count) => total + count, 0)).toBe(10_000)
    expect(layout.pages.join('\n')).toBe(source)
  })

  it('plans conservative continuous-image groups without changing page order', () => {
    const compact = estimateCodeCapturePageBodyHeight('const answer = 42', 16, true, false)
    const wrapped = estimateCodeCapturePageBodyHeight('x'.repeat(900), 14, true, true)
    expect(wrapped).toBeGreaterThan(compact)
    expect(groupCodeCapturePages([
      { index: 0, bodyHeight: 120 }, { index: 1, bodyHeight: 160 }, { index: 2, bodyHeight: 120 }
    ], 400)).toEqual([[0, 1], [2]])
    expect(groupCodeCapturePages([{ index: 4, bodyHeight: 900 }], 400)).toEqual([[4]])
  })

  it('uses stable names for one or several safe continuous-image outputs', () => {
    expect(codeLongImageFileNames(1)).toEqual(['code-long.png'])
    expect(codeLongImageFileNames(3)).toEqual(['code-long-01.png', 'code-long-02.png', 'code-long-03.png'])
    expect(codeLongImageFileNames(0)).toEqual(['code-long.png'])
  })

  it('copies only exact source pages without preview chrome or duplicate separators', () => {
    const pages = ['const first = 1', 'const second = 2\n// keep this slash']
    expect(joinCodePages(pages, [0])).toBe('const first = 1')
    expect(joinCodePages(pages, [0, 1])).toBe('const first = 1\nconst second = 2\n// keep this slash')
    expect(joinCodePages(pages, [1, 1, -1, 8])).toBe('const second = 2\n// keep this slash')
  })
})
