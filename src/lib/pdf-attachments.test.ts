import { describe, expect, it } from 'vitest'
import { PDF_ATTACHMENT_MAX_BYTES, PDF_ATTACHMENT_MAX_COUNT, PDF_ATTACHMENT_MAX_TOTAL_BYTES, pdfAttachmentMime, pdfAttachmentOutputName, safePdfAttachmentName } from './pdf-attachments'

describe('PDF attachment safety helpers', () => {
  it('removes path and Windows filename hazards', () => {
    expect(safePdfAttachmentName('..\\..\\invoice:2026?.pdf')).toBe('invoice-2026-.pdf')
    expect(safePdfAttachmentName('   ', 2)).toBe('attachment-2')
    expect(safePdfAttachmentName('CON.txt', 3)).toBe('attachment-3')
  })

  it('keeps a deterministic source-prefixed name and safe MIME fallback', () => {
    expect(pdfAttachmentOutputName('report.pdf', 'assets/data.json', 3)).toBe('report-attachment-003-data.json')
    expect(pdfAttachmentMime('report-attachment-003-data.json')).toBe('application/json')
    expect(pdfAttachmentMime('report-attachment-004.bin')).toBe('application/octet-stream')
    expect(PDF_ATTACHMENT_MAX_COUNT).toBe(128)
    expect(PDF_ATTACHMENT_MAX_BYTES).toBe(16 * 1024 * 1024)
    expect(PDF_ATTACHMENT_MAX_TOTAL_BYTES).toBe(64 * 1024 * 1024)
  })
})
