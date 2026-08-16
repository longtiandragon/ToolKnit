import { describe, expect, it } from 'vitest'
import { calculatePdfCropBox } from './pdf-crop'

describe('PDF crop box', () => {
  it('converts a top-left percentage selection to PDF coordinates', () => {
    expect(calculatePdfCropBox(600, 800, 10, 20, 50, 40)).toEqual({ x: 60, y: 320, width: 300, height: 320 })
  })

  it('rejects a selection that leaves the page', () => {
    expect(() => calculatePdfCropBox(600, 800, 80, 0, 30, 50)).toThrow('位于页面内')
    expect(() => calculatePdfCropBox(600, 800, 0, 0, 0, 50)).toThrow('位于页面内')
  })
})
