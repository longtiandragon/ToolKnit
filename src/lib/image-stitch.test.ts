import { describe, expect, it } from 'vitest'
import { createStitchOutputPlan, findVerticalOverlap } from '@/lib/image-stitch'

function rows(values: number[][]) { return Uint8Array.from(values.flat()) }

describe('scroll screenshot stitching', () => {
  it('finds the exact shared rows between consecutive screenshots', () => {
    const previous = rows([
      [8, 20, 32, 44, 56, 68, 80, 92],
      [10, 30, 50, 70, 90, 110, 130, 150],
      [12, 35, 58, 81, 104, 127, 150, 173],
      [14, 40, 66, 92, 118, 144, 170, 196],
      [16, 45, 74, 103, 132, 161, 190, 219],
      [18, 50, 82, 114, 146, 178, 210, 242],
    ])
    const next = rows([
      [14, 40, 66, 92, 118, 144, 170, 196],
      [16, 45, 74, 103, 132, 161, 190, 219],
      [18, 50, 82, 114, 146, 178, 210, 242],
      [21, 54, 87, 120, 153, 186, 219, 252],
    ])
    const result = findVerticalOverlap(previous, next, 8, { minRatio: .5, maxRatio: .75 })
    expect(result.rows).toBe(3)
    expect(result.score).toBe(0)
    expect(result.confidence).toBe('high')
  })

  it('marks flat screenshots as uncertain instead of silently cropping them', () => {
    const result = findVerticalOverlap(new Uint8Array(8 * 12).fill(245), new Uint8Array(8 * 12).fill(245), 8)
    expect(result.confidence).toBe('low')
  })

  it('builds offsets and rejects unsafe giant output', () => {
    expect(createStitchOutputPlan(1000, [800, 800, 800], [200, 300])).toEqual({ width: 1000, height: 1900, offsets: [0, 600, 1100] })
    expect(() => createStitchOutputPlan(4000, [20_000, 20_000], [0])).toThrow('超过安全上限')
  })
})
