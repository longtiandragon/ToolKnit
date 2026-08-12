import { describe, expect, it } from 'vitest'
import { sourceHandoffRoute } from './source-handoff'

describe('source handoff routes', () => {
  it('takes an image into the annotation workspace', () => {
    expect(sourceHandoffRoute('image', 'visual')).toEqual({ path: '/visual' })
  })

  it('only sends images to the Windows OCR workspace', () => {
    expect(sourceHandoffRoute('image', 'ocr')).toEqual({ path: '/ocr' })
    expect(sourceHandoffRoute('pdf', 'ocr')).toBeUndefined()
  })

  it('sends images to the supported image-to-PDF file workflow', () => {
    expect(sourceHandoffRoute('image', 'batch')).toEqual({ path: '/tools', query: { group: 'pdf', operation: 'images-to-pdf' } })
  })

  it('sends a PDF to a valid page operation and rejects unrelated inputs', () => {
    expect(sourceHandoffRoute('pdf', 'batch')).toEqual({ path: '/tools', query: { group: 'pdf', operation: 'split' } })
    expect(sourceHandoffRoute('code', 'batch')).toBeUndefined()
  })
})
