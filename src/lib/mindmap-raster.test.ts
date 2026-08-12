import { describe, expect, it } from 'vitest'
import { mindmapRasterDimensions } from './mindmap-raster'

describe('mindmap raster dimensions', () => {
  it('keeps a normal desktop export sharp at two device pixels', () => {
    expect(mindmapRasterDimensions(1200, 700, 2)).toEqual({ width: 2400, height: 1400, scale: 2, limited: false })
  })

  it('caps huge diagrams by both side length and total pixel budget', () => {
    const dimensions = mindmapRasterDimensions(12_000, 8_000, 2)
    expect(dimensions.width).toBe(4096)
    expect(dimensions.height).toBeLessThanOrEqual(4096)
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(16_000_000)
    expect(dimensions.limited).toBe(true)
  })

  it('repairs invalid source dimensions instead of creating a zero-sized canvas', () => {
    expect(mindmapRasterDimensions(Number.NaN, 0)).toEqual({ width: 1, height: 1, scale: 1, limited: false })
  })
})
