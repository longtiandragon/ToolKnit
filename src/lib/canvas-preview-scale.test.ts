import { describe, expect, it } from 'vitest'
import { fitCanvasPreviewScale } from './canvas-preview-scale'

describe('canvas preview scale', () => {
  it('keeps a normal desktop preview at its requested scale', () => {
    expect(fitCanvasPreviewScale(1200, 800, 1.35)).toBe(1.35)
  })

  it('caps a huge scan by pixel budget before allocating its canvas', () => {
    const scale = fitCanvasPreviewScale(10_000, 8_000, 1.35)
    expect(scale).toBeLessThan(1.35)
    expect((10_000 * scale) * (8_000 * scale)).toBeLessThanOrEqual(12_000_000)
  })

  it('also caps a very narrow page by canvas edge length', () => {
    const scale = fitCanvasPreviewScale(20_000, 300, 1)
    expect(20_000 * scale).toBeLessThanOrEqual(8192)
  })

  it('repairs invalid inputs instead of returning an invalid canvas scale', () => {
    expect(fitCanvasPreviewScale(Number.NaN, 0, -1)).toBe(1)
  })
})
