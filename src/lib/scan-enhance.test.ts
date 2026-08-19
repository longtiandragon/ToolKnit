import { describe, expect, it } from 'vitest'
import {
  buildEnhanceCurve,
  computeInverseHomography,
  detectContentBounds,
  detectDocumentQuad,
  estimateDeskewSize,
  fullFrameQuad,
  mapThroughHomography,
  MAX_DESKEW_PIXELS,
  MIN_DESKEW_SIDE,
  orderQuadCorners,
  toGrayscale,
  validateScanQuad,
  type ScanQuad,
} from './scan-enhance'

function makeGray(width: number, height: number, paint: (x: number, y: number) => number) {
  const gray = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) gray[y * width + x] = paint(x, y)
  }
  return gray
}

describe('quad corner ordering', () => {
  it('normalizes corners picked in any order into screen order', () => {
    const ordered = orderQuadCorners([
      { x: 100, y: 400 },
      { x: 300, y: 40 },
      { x: 20, y: 60 },
      { x: 360, y: 380 },
    ])

    expect(ordered).toEqual([
      { x: 20, y: 60 },
      { x: 300, y: 40 },
      { x: 360, y: 380 },
      { x: 100, y: 400 },
    ])
  })

  it('keeps a consistent winding for a quad rotated near 45 degrees', () => {
    const ordered = orderQuadCorners([
      { x: 200, y: 0 },
      { x: 400, y: 200 },
      { x: 200, y: 400 },
      { x: 0, y: 200 },
    ])

    // Walking the result must stay clockwise on screen rather than crossing over.
    const signs = ordered.map((point, index) => {
      const next = ordered[(index + 1) % 4]
      const after = ordered[(index + 2) % 4]
      return Math.sign((next.x - point.x) * (after.y - point.y) - (next.y - point.y) * (after.x - point.x))
    })
    expect(new Set(signs).size).toBe(1)
  })

  it('rejects anything that is not four finite points', () => {
    expect(() => orderQuadCorners([{ x: 0, y: 0 }])).toThrow('矫正需要四个角点。')
    expect(() => orderQuadCorners([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: Number.NaN, y: 10 },
    ])).toThrow('角点坐标无效。')
  })
})

describe('quad validation', () => {
  const frame = fullFrameQuad(800, 600)

  it('accepts a quad that covers the whole frame', () => {
    expect(() => validateScanQuad(frame, 800, 600)).not.toThrow()
  })

  it('rejects corners dragged outside the image', () => {
    const quad: ScanQuad = [{ x: -20, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }]
    expect(() => validateScanQuad(quad, 800, 600)).toThrow('角点超出图片范围，请重新框选。')
  })

  it('rejects a selection whose edge is shorter than the minimum', () => {
    const quad: ScanQuad = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 400 }, { x: 0, y: 400 }]
    expect(() => validateScanQuad(quad, 800, 600)).toThrow(`框选区域的边长不足 ${MIN_DESKEW_SIDE} 像素，请放大框选范围。`)
  })

  it('rejects a self-intersecting quad', () => {
    const quad: ScanQuad = [{ x: 0, y: 0 }, { x: 800, y: 600 }, { x: 800, y: 0 }, { x: 0, y: 600 }]
    expect(() => validateScanQuad(quad, 800, 600)).toThrow('框选区域不是凸四边形，请调整角点。')
  })

  it('rejects collinear corners', () => {
    const quad: ScanQuad = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 0 }, { x: 600, y: 0 }]
    expect(() => validateScanQuad(quad, 800, 600)).toThrow()
  })
})

describe('deskew output size', () => {
  it('takes the longest opposing edges as the output size', () => {
    const quad: ScanQuad = [{ x: 0, y: 0 }, { x: 600, y: 20 }, { x: 590, y: 400 }, { x: 10, y: 380 }]
    const size = estimateDeskewSize(quad)

    expect(size.width).toBe(Math.round(Math.hypot(600, 20)))
    expect(size.height).toBe(Math.round(Math.hypot(10, 380)))
  })

  it('clamps an oversized selection into the deskew pixel budget', () => {
    const side = 6000
    const quad: ScanQuad = [{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: side }, { x: 0, y: side }]
    const size = estimateDeskewSize(quad)

    expect(side * side).toBeGreaterThan(MAX_DESKEW_PIXELS)
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_DESKEW_PIXELS)
    expect(size.width).toBeGreaterThanOrEqual(MIN_DESKEW_SIDE)
  })
})

describe('inverse homography', () => {
  it('maps the destination corners back onto the source quad', () => {
    const quad: ScanQuad = [{ x: 120, y: 60 }, { x: 900, y: 130 }, { x: 860, y: 700 }, { x: 60, y: 620 }]
    const { width, height } = estimateDeskewSize(quad)
    const homography = computeInverseHomography(quad, width, height)

    const corners = [
      { at: { x: 0, y: 0 }, expected: quad[0] },
      { at: { x: width, y: 0 }, expected: quad[1] },
      { at: { x: width, y: height }, expected: quad[2] },
      { at: { x: 0, y: height }, expected: quad[3] },
    ]
    for (const { at, expected } of corners) {
      const mapped = mapThroughHomography(homography, at.x, at.y)
      expect(mapped.x).toBeCloseTo(expected.x, 6)
      expect(mapped.y).toBeCloseTo(expected.y, 6)
    }
  })

  it('stays an identity mapping for an axis-aligned selection', () => {
    const quad: ScanQuad = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]
    const homography = computeInverseHomography(quad, 400, 300)
    const mapped = mapThroughHomography(homography, 137, 89)

    expect(mapped.x).toBeCloseTo(137, 6)
    expect(mapped.y).toBeCloseTo(89, 6)
  })

  it('refuses an invalid output size', () => {
    const quad = fullFrameQuad(400, 300)
    expect(() => computeInverseHomography(quad, 0, 300)).toThrow('矫正输出尺寸无效。')
  })
})

describe('enhance curve', () => {
  it('returns identity for the none mode and for zero strength', () => {
    const none = buildEnhanceCurve({ mode: 'none', strength: 100 })
    const idle = buildEnhanceCurve({ mode: 'text', strength: 0 })

    for (let index = 0; index < 256; index += 1) {
      expect(none[index]).toBe(index)
      expect(idle[index]).toBe(index)
    }
  })

  it('never inverts tones', () => {
    for (const mode of ['text', 'photo'] as const) {
      for (const strength of [10, 55, 100]) {
        const curve = buildEnhanceCurve({ mode, strength })
        for (let index = 1; index < 256; index += 1) {
          expect(curve[index]).toBeGreaterThanOrEqual(curve[index - 1])
        }
      }
    }
  })

  it('pushes paper towards white and ink towards black in text mode', () => {
    const curve = buildEnhanceCurve({ mode: 'text', strength: 100 })

    expect(curve[20]).toBe(0)
    expect(curve[245]).toBe(255)
    expect(curve[40]).toBeLessThan(40)
    expect(curve[215]).toBeGreaterThan(215)
  })

  it('keeps more midtone detail in photo mode than in text mode', () => {
    const text = buildEnhanceCurve({ mode: 'text', strength: 100 })
    const photo = buildEnhanceCurve({ mode: 'photo', strength: 100 })

    expect(Math.abs(photo[128] - 128)).toBeLessThan(Math.abs(text[128] - 128) + 1)
    expect(photo[10]).toBeGreaterThanOrEqual(0)
  })

  it('clamps out-of-range strength instead of producing a broken curve', () => {
    const curve = buildEnhanceCurve({ mode: 'text', strength: 9000 })
    expect(curve[0]).toBe(0)
    expect(curve[255]).toBe(255)
  })
})

describe('grayscale conversion', () => {
  it('weights the channels for luminance', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255])
    const gray = toGrayscale(rgba, 2, 1)

    expect(gray[0]).toBe(Math.round(255 * 299 / 1000))
    expect(gray[1]).toBe(Math.round(255 * 587 / 1000))
  })

  it('rejects truncated pixel data', () => {
    expect(() => toGrayscale(new Uint8ClampedArray(4), 4, 4)).toThrow('图片像素数据不完整。')
  })
})

describe('content detection', () => {
  it('finds a dark page on a light background', () => {
    const gray = makeGray(400, 300, (x, y) => (x >= 60 && x < 340 && y >= 40 && y < 260 ? 30 : 250))
    const bounds = detectContentBounds(gray, 400, 300)

    expect(bounds).toEqual({ left: 60, top: 40, width: 280, height: 220 })
  })

  it('builds the starting quad from the detected bounds', () => {
    const gray = makeGray(400, 300, (x, y) => (x >= 60 && x < 340 && y >= 40 && y < 260 ? 30 : 250))
    const quad = detectDocumentQuad(gray, 400, 300)

    expect(quad).toEqual([
      { x: 60, y: 40 },
      { x: 340, y: 40 },
      { x: 340, y: 260 },
      { x: 60, y: 260 },
    ])
  })

  it('returns null for a blank image instead of inventing a crop', () => {
    const gray = makeGray(200, 200, () => 240)
    expect(detectContentBounds(gray, 200, 200)).toBeNull()
    expect(detectDocumentQuad(gray, 200, 200)).toBeNull()
  })

  it('returns null when the content already fills the frame', () => {
    const gray = makeGray(200, 200, (x, y) => ((x + y) % 2 ? 20 : 230))
    expect(detectContentBounds(gray, 200, 200)).toBeNull()
  })

  it('returns null when the detected box is too small to be trusted', () => {
    const gray = makeGray(200, 200, (x, y) => (x >= 100 && x < 104 && y >= 100 && y < 104 ? 10 : 250))
    expect(detectContentBounds(gray, 200, 200)).toBeNull()
  })

  it('ignores border speckle that stays under the coverage threshold', () => {
    // 10 stray pixels sit well below the 4% of 400 that a row needs to count.
    const gray = makeGray(400, 300, (x, y) => {
      if (x >= 80 && x < 320 && y >= 60 && y < 240) return 40
      if (y === 0 && x < 10) return 10
      return 245
    })
    const bounds = detectContentBounds(gray, 400, 300)

    expect(bounds).toEqual({ left: 80, top: 60, width: 240, height: 180 })
  })

  it('uses the median border tone so a grey background still works', () => {
    const gray = makeGray(400, 300, (x, y) => (x >= 80 && x < 320 && y >= 60 && y < 240 ? 235 : 120))
    const bounds = detectContentBounds(gray, 400, 300)

    expect(bounds).toEqual({ left: 80, top: 60, width: 240, height: 180 })
  })

  it('rejects malformed input rather than throwing', () => {
    expect(detectContentBounds(new Uint8ClampedArray(4), 100, 100)).toBeNull()
    expect(detectContentBounds(new Uint8ClampedArray(0), 0, 0)).toBeNull()
  })
})
