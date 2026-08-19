import { MAX_IMAGE_PROCESS_PIXELS } from '@/lib/image-processing'

export interface ScanPoint {
  x: number
  y: number
}

/** Corners in screen order: top-left, top-right, bottom-right, bottom-left. */
export type ScanQuad = [ScanPoint, ScanPoint, ScanPoint, ScanPoint]

export type ScanEnhanceMode = 'none' | 'text' | 'photo'

export interface ScanEnhanceOptions {
  mode: ScanEnhanceMode
  /** 0–100. 0 leaves the curve untouched whatever the mode is. */
  strength: number
}

export interface ScanContentBounds {
  left: number
  top: number
  width: number
  height: number
}

/** Backward warping samples every destination pixel in JS, so it is far more
 * expensive per pixel than the `drawImage` path the other raster modes use.
 * This cap is deliberately well below MAX_IMAGE_PROCESS_PIXELS. */
export const MAX_DESKEW_PIXELS = Math.min(12_000_000, MAX_IMAGE_PROCESS_PIXELS)
export const MIN_DESKEW_SIDE = 16

function isFinitePoint(point: ScanPoint | undefined): point is ScanPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
}

function distance(a: ScanPoint, b: ScanPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function cross(origin: ScanPoint, a: ScanPoint, b: ScanPoint) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
}

/** Normalizes four corners picked in any order into top-left, top-right,
 * bottom-right, bottom-left. Sorting by angle around the centroid keeps working
 * for quads rotated near 45°, where the usual x+y / x-y heuristic flips two
 * corners. */
export function orderQuadCorners(points: ScanPoint[]): ScanQuad {
  if (!Array.isArray(points) || points.length !== 4) throw new Error('矫正需要四个角点。')
  if (!points.every(isFinitePoint)) throw new Error('角点坐标无效。')

  const centroidX = points.reduce((total, point) => total + point.x, 0) / 4
  const centroidY = points.reduce((total, point) => total + point.y, 0) / 4
  // Canvas y grows downwards, so ascending atan2 walks the corners clockwise
  // as they appear on screen.
  const clockwise = [...points].sort((a, b) => (
    Math.atan2(a.y - centroidY, a.x - centroidX) - Math.atan2(b.y - centroidY, b.x - centroidX)
  ))

  let start = 0
  let best = Infinity
  for (let index = 0; index < 4; index += 1) {
    const score = clockwise[index].x + clockwise[index].y
    if (score < best) {
      best = score
      start = index
    }
  }

  return [
    clockwise[start % 4],
    clockwise[(start + 1) % 4],
    clockwise[(start + 2) % 4],
    clockwise[(start + 3) % 4],
  ].map(point => ({ x: point.x, y: point.y })) as ScanQuad
}

/** Throws when the quad cannot produce a usable warp. Tolerance covers corner
 * handles dragged a fraction of a pixel past the edge. */
export function validateScanQuad(quad: ScanQuad, width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('图片尺寸无效，无法矫正。')
  }
  if (!Array.isArray(quad) || quad.length !== 4 || !quad.every(isFinitePoint)) {
    throw new Error('矫正需要四个有效角点。')
  }

  const tolerance = 1
  for (const point of quad) {
    if (point.x < -tolerance || point.y < -tolerance || point.x > width + tolerance || point.y > height + tolerance) {
      throw new Error('角点超出图片范围，请重新框选。')
    }
  }

  for (let index = 0; index < 4; index += 1) {
    const side = distance(quad[index], quad[(index + 1) % 4])
    if (side < MIN_DESKEW_SIDE) throw new Error(`框选区域的边长不足 ${MIN_DESKEW_SIDE} 像素，请放大框选范围。`)
  }

  // A self-intersecting or collinear quad has no usable homography.
  let positive = 0
  let negative = 0
  for (let index = 0; index < 4; index += 1) {
    const value = cross(quad[index], quad[(index + 1) % 4], quad[(index + 2) % 4])
    if (value > 0) positive += 1
    else if (value < 0) negative += 1
  }
  if (positive !== 4 && negative !== 4) throw new Error('框选区域不是凸四边形，请调整角点。')
}

/** Derives the corrected output size from the quad's own edge lengths, then
 * clamps it so the warp stays inside the pixel budget. */
export function estimateDeskewSize(quad: ScanQuad) {
  validateScanQuad(quad, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)

  const [topLeft, topRight, bottomRight, bottomLeft] = quad
  const width = Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight))
  const height = Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight))

  let targetWidth = Math.max(MIN_DESKEW_SIDE, Math.round(width))
  let targetHeight = Math.max(MIN_DESKEW_SIDE, Math.round(height))

  const pixels = targetWidth * targetHeight
  if (pixels > MAX_DESKEW_PIXELS) {
    const scale = Math.sqrt(MAX_DESKEW_PIXELS / pixels)
    targetWidth = Math.max(MIN_DESKEW_SIDE, Math.floor(targetWidth * scale))
    targetHeight = Math.max(MIN_DESKEW_SIDE, Math.floor(targetHeight * scale))
  }

  return { width: targetWidth, height: targetHeight }
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length
  const rows = matrix.map((row, index) => [...row, vector[index]])

  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) throw new Error('框选区域无法计算矫正参数，请调整角点。')
    if (pivot !== column) [rows[column], rows[pivot]] = [rows[pivot], rows[column]]

    const divisor = rows[column][column]
    for (let index = column; index <= size; index += 1) rows[column][index] /= divisor

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = rows[row][column]
      if (!factor) continue
      for (let index = column; index <= size; index += 1) rows[row][index] -= factor * rows[column][index]
    }
  }

  return rows.map(row => row[size])
}

/** Row-major 3x3 mapping destination pixels back onto source pixels, which is
 * the direction a backward warp needs. */
export function computeInverseHomography(quad: ScanQuad, targetWidth: number, targetHeight: number) {
  if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth < 1 || targetHeight < 1) {
    throw new Error('矫正输出尺寸无效。')
  }
  validateScanQuad(quad, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)

  const destination: ScanPoint[] = [
    { x: 0, y: 0 },
    { x: targetWidth, y: 0 },
    { x: targetWidth, y: targetHeight },
    { x: 0, y: targetHeight },
  ]

  const matrix: number[][] = []
  const vector: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const { x: u, y: v } = destination[index]
    const { x, y } = quad[index]
    matrix.push([u, v, 1, 0, 0, 0, -u * x, -v * x])
    vector.push(x)
    matrix.push([0, 0, 0, u, v, 1, -u * y, -v * y])
    vector.push(y)
  }

  const solution = solveLinearSystem(matrix, vector)
  return [...solution, 1]
}

export function mapThroughHomography(homography: number[], x: number, y: number): ScanPoint {
  const denominator = homography[6] * x + homography[7] * y + homography[8]
  if (!denominator) throw new Error('矫正参数无效。')
  return {
    x: (homography[0] * x + homography[1] * y + homography[2]) / denominator,
    y: (homography[3] * x + homography[4] * y + homography[5]) / denominator,
  }
}

/** 256-entry lookup table. Always monotonic non-decreasing so the curve can
 * never invert tones. */
export function buildEnhanceCurve(options: ScanEnhanceOptions) {
  const curve = new Uint8ClampedArray(256)
  const strength = Math.min(100, Math.max(0, Number(options.strength) || 0)) / 100

  if (options.mode === 'none' || strength === 0) {
    for (let index = 0; index < 256; index += 1) curve[index] = index
    return curve
  }

  // 'text' pulls paper towards white and ink towards black; 'photo' keeps far
  // more midtone detail because losing it would ruin an ordinary picture.
  const blackPoint = options.mode === 'text' ? 60 * strength : 24 * strength
  const whitePoint = 255 - (options.mode === 'text' ? 45 * strength : 18 * strength)
  const span = Math.max(1, whitePoint - blackPoint)

  for (let index = 0; index < 256; index += 1) {
    const normalized = Math.min(1, Math.max(0, (index - blackPoint) / span))
    const contrasted = options.mode === 'text'
      // Smoothstep sharpens the ink/paper boundary without clipping either end.
      ? normalized * normalized * (3 - 2 * normalized)
      : normalized
    const blended = normalized + (contrasted - normalized) * strength
    curve[index] = Math.round(blended * 255)
  }

  return curve
}

export function toGrayscale(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number) {
  const expected = width * height * 4
  if (rgba.length < expected) throw new Error('图片像素数据不完整。')
  const gray = new Uint8ClampedArray(width * height)
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4
    gray[index] = (rgba[offset] * 299 + rgba[offset + 1] * 587 + rgba[offset + 2] * 114) / 1000
  }
  return gray
}

export interface DetectContentOptions {
  /** How far a pixel must sit from the border tone to count as content. */
  tolerance?: number
  /** Fraction of a row/column that must be content before the scan stops. */
  coverage?: number
}

/** Finds the content box by scanning inward from each border.
 *
 * This is an axis-aligned guess — it answers "where are the margins", not
 * "where are the page corners". It exists to give the corner picker a sensible
 * starting rectangle and to drive auto-trim; perspective still has to be set by
 * dragging the corners. Returns null rather than a low-confidence box. */
export function detectContentBounds(
  gray: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: DetectContentOptions = {},
): ScanContentBounds | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null
  if (gray.length < width * height) return null

  const tolerance = Math.max(1, options.tolerance ?? 28)
  const coverage = Math.min(1, Math.max(0, options.coverage ?? 0.04))

  const border: number[] = []
  for (let x = 0; x < width; x += 1) {
    border.push(gray[x], gray[(height - 1) * width + x])
  }
  for (let y = 0; y < height; y += 1) {
    border.push(gray[y * width], gray[y * width + width - 1])
  }
  border.sort((a, b) => a - b)
  const background = border[Math.floor(border.length / 2)]

  const isContent = (x: number, y: number) => Math.abs(gray[y * width + x] - background) > tolerance

  const rowThreshold = Math.max(1, Math.round(width * coverage))
  const columnThreshold = Math.max(1, Math.round(height * coverage))

  const rowHits = new Array<number>(height).fill(0)
  const columnHits = new Array<number>(width).fill(0)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isContent(x, y)) continue
      rowHits[y] += 1
      columnHits[x] += 1
    }
  }

  let top = 0
  while (top < height && rowHits[top] < rowThreshold) top += 1
  let bottom = height - 1
  while (bottom > top && rowHits[bottom] < rowThreshold) bottom -= 1
  let left = 0
  while (left < width && columnHits[left] < columnThreshold) left += 1
  let right = width - 1
  while (right > left && columnHits[right] < columnThreshold) right -= 1

  const boxWidth = right - left + 1
  const boxHeight = bottom - top + 1
  if (boxWidth < MIN_DESKEW_SIDE || boxHeight < MIN_DESKEW_SIDE) return null
  // Nothing worth trimming: say so instead of returning the whole frame as if
  // it were a detection.
  if (boxWidth >= width * 0.985 && boxHeight >= height * 0.985) return null

  return { left, top, width: boxWidth, height: boxHeight }
}

/** Starting quad for the corner picker, derived from {@link detectContentBounds}.
 * Null means "no confident guess" — callers should fall back to the full frame
 * rather than showing an invented crop. */
export function detectDocumentQuad(
  gray: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: DetectContentOptions = {},
): ScanQuad | null {
  const bounds = detectContentBounds(gray, width, height, options)
  if (!bounds) return null
  const right = bounds.left + bounds.width
  const bottom = bounds.top + bounds.height
  return [
    { x: bounds.left, y: bounds.top },
    { x: right, y: bounds.top },
    { x: right, y: bottom },
    { x: bounds.left, y: bottom },
  ]
}

export function fullFrameQuad(width: number, height: number): ScanQuad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
}
