import { describe, expect, it } from 'vitest'
import { PDF_OUTLINE_MAX_DEPTH, PDF_OUTLINE_MAX_ITEMS, buildPdfOutlineReport, pdfOutlineOutputName } from './pdf-outline'

describe('PDF outline report', () => {
  it('normalizes bookmark metadata and keeps nested items', () => {
    const report = JSON.parse(buildPdfOutlineReport('guide.pdf', [{ title: '章节一', dest: ['page-1'], color: [12, 34, 56], items: [{ title: '外链', url: 'https://example.com', bold: true }] }]))
    expect(report.itemCount).toBe(2)
    expect(report.items[0].color).toBe('#0c2238')
    expect(report.items[0].items[0].url).toBe('https://example.com')
    expect(report.items[0].items[0].bold).toBe(true)
    expect(report.items[0].hasDestination).toBe(true)
  })

  it('bounds hostile or oversized outline trees', () => {
    const deep = { title: 'x', items: [] as unknown[] }
    let cursor = deep
    for (let index = 0; index < PDF_OUTLINE_MAX_DEPTH + 3; index += 1) {
      const child = { title: 'nested', items: [] as unknown[] }
      cursor.items.push(child)
      cursor = child
    }
    const many = Array.from({ length: PDF_OUTLINE_MAX_ITEMS + 2 }, (_, index) => ({ title: `item-${index}` }))
    const report = JSON.parse(buildPdfOutlineReport('guide.pdf', [deep, ...many]))
    expect(report.truncated).toBe(true)
    expect(report.itemCount).toBe(PDF_OUTLINE_MAX_ITEMS)
    expect(pdfOutlineOutputName('guide.pdf')).toBe('guide-bookmarks.json')
  })
})
