import { describe, expect, it } from 'vitest'
import { calculateCodeLayout, codeCharactersPerLine, codeLongImageFileNames, estimateCodeCapturePageBodyHeight, groupCodeCapturePages, joinCodePages, MAX_CODE_FONT_SIZE, MAX_CODE_LINES_PER_PAGE, MIN_CODE_FONT_SIZE, MIN_CODE_LINES_PER_PAGE, normalizeCodeCardWidth, normalizeCodeFontSize, normalizeCodeLinesPerPage } from './code-layout'

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

  it('paginates by a manual page height and still reports the automatic one', () => {
    const source = Array.from({ length: 100 }, (_, index) => `const row${index} = ${index}`).join('\n')
    const layout = calculateCodeLayout(source, { linesPerPage: 10 })
    expect(layout.linesPerPage).toBe(10)
    expect(layout.automaticLinesPerPage).toBe(38)
    expect(layout.pages).toHaveLength(10)
    expect(layout.pages.join('\n')).toBe(source)
    expect(layout.pageLineCounts.reduce((total, count) => total + count, 0)).toBe(100)
  })

  it('falls back to the automatic page height for an absent or unusable manual one', () => {
    const source = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')
    const automatic = calculateCodeLayout(source).linesPerPage
    expect(calculateCodeLayout(source, { linesPerPage: 0 }).linesPerPage).toBe(automatic)
    expect(calculateCodeLayout(source, { linesPerPage: Number.NaN }).linesPerPage).toBe(automatic)
    expect(calculateCodeLayout(source, { linesPerPage: -12 }).linesPerPage).toBe(automatic)
  })

  it('clamps a manual page height instead of making thousands of tiny pages', () => {
    expect(normalizeCodeLinesPerPage(1)).toBe(MIN_CODE_LINES_PER_PAGE)
    expect(normalizeCodeLinesPerPage(99_999)).toBe(MAX_CODE_LINES_PER_PAGE)
    expect(normalizeCodeLinesPerPage(24.6)).toBe(25)
    expect(normalizeCodeLinesPerPage(0)).toBe(0)
    expect(normalizeCodeLinesPerPage('30')).toBe(0)
    expect(calculateCodeLayout('a\nb\nc', { linesPerPage: 1 }).linesPerPage).toBe(MIN_CODE_LINES_PER_PAGE)
  })

  it('lays out a large snippet without losing lines or allocating per-line code-point arrays', () => {
    const source = Array.from({ length: 10_000 }, (_, index) => `const row${index} = '中文 😀 ${index}'`).join('\n')
    const layout = calculateCodeLayout(source)
    expect(layout.lineCount).toBe(10_000)
    expect(layout.pageLineCounts.reduce((total, count) => total + count, 0)).toBe(10_000)
    expect(layout.pages.join('\n')).toBe(source)
  })

  it('takes a manual code size and still reports the automatic one', () => {
    const layout = calculateCodeLayout('const answer = 42', { fontSize: 28 })
    expect(layout.fontSize).toBe(28)
    expect(layout.automaticFontSize).toBe(20)
    expect(normalizeCodeFontSize(4)).toBe(MIN_CODE_FONT_SIZE)
    expect(normalizeCodeFontSize(900)).toBe(MAX_CODE_FONT_SIZE)
    expect(normalizeCodeFontSize(0)).toBe(0)
    expect(calculateCodeLayout('const answer = 42', { fontSize: 0 }).fontSize).toBe(20)
  })

  it('lets a wider card carry a longer line before shrinking the text', () => {
    const source = 'x'.repeat(75)
    const standard = calculateCodeLayout(source)
    const wide = calculateCodeLayout(source, { cardWidth: 1080 })
    expect(standard.cardWidth).toBe(720)
    expect(wide.cardWidth).toBe(1080)
    expect(wide.automaticFontSize).toBeGreaterThan(standard.automaticFontSize)
    expect(codeCharactersPerLine(1080, 16, true)).toBeGreaterThan(codeCharactersPerLine(720, 16, true))
    expect(codeCharactersPerLine(720, 16, false)).toBeGreaterThan(codeCharactersPerLine(720, 16, true))
    const wrapped = Array.from({ length: 30 }, () => source).join('\n')
    expect(estimateCodeCapturePageBodyHeight(wrapped, 16, true, true, 1080))
      .toBeLessThan(estimateCodeCapturePageBodyHeight(wrapped, 16, true, true, 720))
  })

  it('refuses a card width that is not an offered preset', () => {
    expect(normalizeCodeCardWidth(900)).toBe(900)
    expect(normalizeCodeCardWidth(999)).toBe(720)
    expect(normalizeCodeCardWidth('1080')).toBe(720)
    expect(normalizeCodeCardWidth(undefined)).toBe(720)
    expect(calculateCodeLayout('const answer = 42', { cardWidth: 4000 }).cardWidth).toBe(720)
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
