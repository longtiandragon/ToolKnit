export const CONCAT_MAX_FILES = 60
export const CONCAT_MAX_PIXELS = 64_000_000
export const CONCAT_MAX_DIMENSION = 24_000
export const CONCAT_MAX_CROSS = 4000
export const CONCAT_MIN_CROSS = 400
export const CONCAT_WIDTH_MIN = 200
export const CONCAT_WIDTH_MAX = 4000

export type ConcatDirection = 'vertical' | 'horizontal'
export type ConcatFit = 'contain' | 'cover'

export interface ConcatInputSize { width: number; height: number }

/** One complete draw instruction in canvas coordinates. The worker applies
 *  these verbatim — no direction logic lives there, because mixing axis
 *  semantics between plan and painter is exactly how images end up squished
 *  or clipped. */
export interface ConcatDrawFrame {
  /** Destination rectangle on the canvas. */
  x: number
  y: number
  w: number
  h: number
  /** Source rectangle in the image's original pixels. */
  sx: number
  sy: number
  sw: number
  sh: number
}

export interface ConcatOutputPlan {
  /** Canvas size in pixels, direction-aware. */
  width: number
  height: number
  /** Main-axis offset for every image, so index 0 starts at 0. */
  offsets: number[]
  /** Uniform scale applied to every image (1 = natural size). */
  scale: number
  /** Cross-axis canvas size. */
  cross: number
  /** Complete draw instruction per image. */
  frames: ConcatDrawFrame[]
}

function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export interface ConcatUniformOptions {
  /** Every image lands in an identical cell instead of keeping its own size. */
  uniform?: boolean
  /** How an image fits its cell in uniform mode. */
  fit?: ConcatFit
  /** Every image is scaled to exactly this canvas width. Takes precedence
   *  over the default shared-cap scaling; small images are upscaled. */
  width?: number
  /** With `width`: true keeps each image's own aspect ratio (heights vary),
   *  false stretches everything to the batch's median ratio as well. */
  lockAspect?: boolean
}

/**
 * Plans a straight concatenation of many images along one axis.
 *
 * The gap is a signed spacing between consecutive images: 0 leaves no seam,
 * positive values leave visible white space, negative values make each image
 * overlap the previous one — the later image is drawn on top, which reads as
 * layers stacking. Offsets are shifted so the canvas always starts at the
 * first visible pixel, no matter how negative the gaps get.
 *
 * By default every image keeps its natural aspect ratio under one shared
 * scale (the largest cross-axis side is capped at `maxCross`) and is centered
 * on the cross axis. With `uniform`, all images are drawn into identical
 * cells: the cell's cross side is that same cap and its main side follows
 * the batch's median aspect ratio, so mixed certificates and photos line up
 * into a tidy wall. `fit` chooses letterboxing (`contain`) or cropping
 * (`cover`) inside the cell.
 */
export function createConcatOutputPlan(
  sizes: readonly ConcatInputSize[],
  direction: ConcatDirection,
  gap: number,
  maxCross: number,
  options: ConcatUniformOptions = {},
): ConcatOutputPlan {
  if (!sizes.length || sizes.length > CONCAT_MAX_FILES) throw new Error(`拼成长图需要 2–${CONCAT_MAX_FILES} 张图片。`)
  if (sizes.length < 2) throw new Error('请至少导入 2 张图片。')
  if (!Number.isFinite(maxCross)) throw new Error('尺寸上限无效。')
  for (const size of sizes) {
    if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) {
      throw new Error('有一张图片尺寸无效，无法拼接。')
    }
  }
  const cap = Math.max(CONCAT_MIN_CROSS, Math.min(CONCAT_MAX_CROSS, Math.trunc(maxCross)))
  const spacing = Number.isFinite(gap) ? Math.trunc(gap) : 0
  const vertical = direction === 'vertical'
  const fit: ConcatFit = options.fit === 'cover' ? 'cover' : 'contain'
  const crossOf = (size: ConcatInputSize) => (vertical ? size.width : size.height)
  const mainOf = (size: ConcatInputSize) => (vertical ? size.height : size.width)
  const crossNaturalMax = Math.max(...sizes.map(crossOf))
  const scale = Math.min(1, cap / crossNaturalMax)

  let cross = 0
  let cellMain = 0
  const frames: ConcatDrawFrame[] = []
  const mainSizes: number[] = []
  if (options.uniform) {
    cross = Math.min(cap, crossNaturalMax) || 1
    const medianRatio = median(sizes.map((size) => mainOf(size) / crossOf(size)))
    cellMain = Math.max(1, Math.round(cross * medianRatio))
    // Canvas-space cell: the main axis is the strip's long edge.
    const cellW = vertical ? cross : cellMain
    const cellH = vertical ? cellMain : cross
    for (const size of sizes) {
      const frameScale = fit === 'contain'
        ? Math.min(cellW / size.width, cellH / size.height)
        : Math.max(cellW / size.width, cellH / size.height)
      if (fit === 'contain') {
        const w = Math.max(1, Math.round(size.width * frameScale))
        const h = Math.max(1, Math.round(size.height * frameScale))
        frames.push({ x: Math.round((cellW - w) / 2), y: Math.round((cellH - h) / 2), w, h, sx: 0, sy: 0, sw: size.width, sh: size.height })
      } else {
        const sw = Math.max(1, Math.round(cellW / frameScale))
        const sh = Math.max(1, Math.round(cellH / frameScale))
        frames.push({ x: 0, y: 0, w: cellW, h: cellH, sx: Math.round((size.width - sw) / 2), sy: Math.round((size.height - sh) / 2), sw, sh })
      }
      mainSizes.push(cellMain)
    }
  } else if (options.width) {
    const targetWidth = Math.max(CONCAT_WIDTH_MIN, Math.min(CONCAT_WIDTH_MAX, Math.trunc(options.width)))
    const medianRatio = median(sizes.map((size) => size.height / size.width))
    for (const size of sizes) {
      const frameScale = targetWidth / size.width
      const h = options.lockAspect === false
        ? Math.max(1, Math.round(targetWidth * medianRatio))
        : Math.max(1, Math.round(size.height * frameScale))
      frames.push({ x: 0, y: 0, w: targetWidth, h, sx: 0, sy: 0, sw: size.width, sh: size.height })
      mainSizes.push(vertical ? h : targetWidth)
      cross = Math.max(cross, vertical ? targetWidth : h)
    }
  } else {
    const scaled = sizes.map((size) => ({
      w: Math.max(1, Math.round(size.width * scale)),
      h: Math.max(1, Math.round(size.height * scale)),
    }))
    cross = Math.max(...scaled.map((frame) => (vertical ? frame.w : frame.h)))
    scaled.forEach((frame, index) => {
      frames.push({ x: 0, y: 0, w: frame.w, h: frame.h, sx: 0, sy: 0, sw: sizes[index].width, sh: sizes[index].height })
      mainSizes.push(vertical ? frame.h : frame.w)
    })
  }
  const rawOffsets = [0]
  for (let index = 1; index < frames.length; index += 1) {
    rawOffsets.push(rawOffsets[index - 1] + mainSizes[index - 1] + spacing)
  }
  const minOffset = Math.min(...rawOffsets)
  const offsets = rawOffsets.map((offset) => offset - minOffset)
  const main = Math.max(...offsets.map((offset, index) => offset + mainSizes[index]))
  if (cross > CONCAT_MAX_DIMENSION || main > CONCAT_MAX_DIMENSION || cross * main > CONCAT_MAX_PIXELS) {
    const knob = options.width ? '“统一宽度”' : '“尺寸上限”'
    throw new Error(`拼接结果预计为 ${cross} × ${main} 像素，超过安全上限；请调低${knob}或分成两批拼接。`)
  }
  // Position every frame along the strip now that the offsets exist.
  if (options.uniform) {
    frames.forEach((frame, index) => {
      if (vertical) frame.y += offsets[index]
      else frame.x += offsets[index]
    })
  } else {
    frames.forEach((frame, index) => {
      if (vertical) { frame.x = Math.round((cross - frame.w) / 2); frame.y = offsets[index] }
      else { frame.x = offsets[index]; frame.y = Math.round((cross - frame.h) / 2) }
    })
  }
  return {
    width: vertical ? cross : main,
    height: vertical ? main : cross,
    offsets,
    scale,
    cross,
    frames,
  }
}
