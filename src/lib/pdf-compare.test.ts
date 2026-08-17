import { describe, expect, it } from 'vitest'
import { buildPdfCompareReport, comparePdfPageSnapshots, normalizePdfComparisonText } from './pdf-compare'

describe('PDF page comparison', () => {
  it('normalizes layout whitespace but detects text and page-size changes', () => {
    const left = { text: 'Hello\n  world', width: 612, height: 792 }
    const same = { text: 'Hello world', width: 612.04, height: 792 }
    expect(normalizePdfComparisonText(left.text)).toBe('Hello world')
    expect(comparePdfPageSnapshots(left, same)).toBe('same')
    expect(comparePdfPageSnapshots(left, { ...same, text: 'Hello changed' })).toBe('changed')
    expect(comparePdfPageSnapshots(left, { ...same, width: 595 })).toBe('changed')
  })

  it('keeps missing pages and scan-only pages explicit in the report', () => {
    const pages = [
      { page: 1, status: comparePdfPageSnapshots({ text: '', width: 100, height: 100 }, { text: '', width: 100, height: 100 }), left: { text: '', width: 100, height: 100 }, right: { text: '', width: 100, height: 100 } },
      { page: 2, status: comparePdfPageSnapshots(undefined, { text: 'new', width: 100, height: 100 }), right: { text: 'new', width: 100, height: 100 } },
    ] as const
    const report = buildPdfCompareReport('left.pdf', 'right.pdf', [...pages])
    expect(report).toContain('未验证 1')
    expect(report).toContain('右侧新增 1')
    expect(report).toContain('第 2 页 · 右侧新增')
  })
})
