export const STITCH_MAX_FILES = 24
export const STITCH_MAX_PIXELS = 64_000_000
export const STITCH_MAX_HEIGHT = 32_767

export type StitchOverlap = {
  rows: number
  score: number
  confidence: 'high' | 'low'
}

export type StitchOutputPlan = {
  width: number
  height: number
  offsets: number[]
}

function sampleDistance(
  previous: Uint8Array,
  next: Uint8Array,
  width: number,
  previousRows: number,
  overlap: number,
) {
  const edge = Math.max(1, Math.floor(width * 0.08))
  const startRow = Math.max(0, Math.floor(overlap * 0.08))
  const endRow = Math.max(startRow + 1, Math.ceil(overlap * 0.94))
  let difference = 0
  let texture = 0
  let count = 0
  for (let row = startRow; row < endRow; row += 1) {
    const previousOffset = (previousRows - overlap + row) * width
    const nextOffset = row * width
    for (let column = edge; column < width - edge; column += 2) {
      const left = previous[previousOffset + column]
      const right = next[nextOffset + column]
      difference += Math.abs(left - right)
      if (column > edge) {
        const previousGradient = left - previous[previousOffset + column - 2]
        const nextGradient = right - next[nextOffset + column - 2]
        difference += Math.abs(previousGradient - nextGradient) * 0.45
        texture += Math.abs(previousGradient) + Math.abs(nextGradient)
      }
      count += 1
    }
  }
  return {
    score: count ? difference / count : Number.POSITIVE_INFINITY,
    texture: count ? texture / count : 0,
  }
}

/**
 * Finds the number of sampled rows shared by the bottom of one screenshot and
 * the top of the next. Samples are intentionally tiny grayscale rasters so the
 * expensive search can stay bounded even when source screenshots are huge.
 */
export function findVerticalOverlap(
  previous: Uint8Array,
  next: Uint8Array,
  width: number,
  options: { minRatio?: number; maxRatio?: number } = {},
): StitchOverlap {
  if (!Number.isInteger(width) || width < 8 || previous.length % width || next.length % width) {
    throw new Error('滚动截图采样数据无效。')
  }
  const previousRows = previous.length / width
  const nextRows = next.length / width
  const commonRows = Math.min(previousRows, nextRows)
  const minimum = Math.max(3, Math.floor(commonRows * (options.minRatio ?? 0.06)))
  const maximum = Math.max(minimum, Math.floor(commonRows * (options.maxRatio ?? 0.86)))
  let bestRows = 0
  let bestScore = Number.POSITIVE_INFINITY
  let bestTexture = 0
  for (let overlap = minimum; overlap <= maximum; overlap += 1) {
    const candidate = sampleDistance(previous, next, width, previousRows, overlap)
    if (candidate.score < bestScore) {
      bestRows = overlap
      bestScore = candidate.score
      bestTexture = candidate.texture
    }
  }
  const confidence = bestScore <= 14 && bestTexture >= 1.2 ? 'high' : 'low'
  return { rows: bestRows, score: Number(bestScore.toFixed(2)), confidence }
}

export function createStitchOutputPlan(width: number, heights: readonly number[], overlaps: readonly number[]): StitchOutputPlan {
  if (!Number.isInteger(width) || width < 1 || !heights.length || heights.length > STITCH_MAX_FILES) {
    throw new Error(`滚动截图需要 1–${STITCH_MAX_FILES} 张有效图片。`)
  }
  if (overlaps.length !== heights.length - 1) throw new Error('滚动截图重叠数据不完整。')
  const offsets = [0]
  let height = heights[0]
  for (let index = 1; index < heights.length; index += 1) {
    const frameHeight = Math.trunc(heights[index])
    const overlap = Math.trunc(overlaps[index - 1])
    if (frameHeight < 1 || overlap < 0 || overlap >= frameHeight) throw new Error('滚动截图尺寸或重叠区域无效。')
    offsets.push(height - overlap)
    height += frameHeight - overlap
  }
  if (height > STITCH_MAX_HEIGHT || width * height > STITCH_MAX_PIXELS) {
    throw new Error(`拼接结果预计为 ${width} × ${height} 像素，超过安全上限；请分成两组拼接。`)
  }
  return { width, height, offsets }
}
