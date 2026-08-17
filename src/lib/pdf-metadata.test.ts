import { describe, expect, it } from 'vitest'
import { PDF_METADATA_MAX_KEYS, PDF_METADATA_MAX_PAGES, buildPdfMetadataReport, pdfMetadataOutputName } from './pdf-metadata'

describe('PDF metadata report', () => {
  it('keeps bounded scalar metadata, permissions and page geometry', () => {
    const report = JSON.parse(buildPdfMetadataReport('report.pdf', {
      pageCount: 2,
      fingerprints: ['abc', 'def'],
      info: { Title: '  A guide  ', CreationDate: 'D:20260817' },
      metadata: { dcTitle: 'A guide', ignored: { nested: true } },
      permissions: [4, 16, -1, 2.5],
      pages: [{ width: 612.345, height: 792, rotation: 90 }, { width: 300, height: 400, rotation: 0 }],
    }))
    expect(report.fileName).toBe('report.pdf')
    expect(report.info.Title).toBe('A guide')
    expect(report.metadata.dcTitle).toBe('A guide')
    expect(report.metadata.ignored).toBeUndefined()
    expect(report.permissions).toEqual([4, 16])
    expect(report.pages[0]).toEqual({ page: 1, width: 612.35, height: 792, rotation: 90 })
    expect(report.pagesTruncated).toBe(false)
    expect(pdfMetadataOutputName('report.pdf')).toBe('report-metadata.json')
  })

  it('bounds hostile metadata keys and page snapshots', () => {
    const info = Object.fromEntries(Array.from({ length: PDF_METADATA_MAX_KEYS + 10 }, (_, index) => [`key-${index}`, `value-${index}`]))
    const pages = Array.from({ length: PDF_METADATA_MAX_PAGES + 2 }, () => ({ width: 1, height: 2, rotation: 0 }))
    const report = JSON.parse(buildPdfMetadataReport('large.pdf', { pageCount: pages.length, info, pages }))
    expect(Object.keys(report.info)).toHaveLength(PDF_METADATA_MAX_KEYS)
    expect(report.pages).toHaveLength(PDF_METADATA_MAX_PAGES)
    expect(report.pagesTruncated).toBe(true)
  })
})
