import { describe, expect, it } from 'vitest'
import { CONCAT_MAX_FILES, CONCAT_MAX_PIXELS, createConcatOutputPlan } from './image-concat'

const square = { width: 1000, height: 1000 }
const wide = { width: 1600, height: 900 }
const tall = { width: 900, height: 1600 }

describe('createConcatOutputPlan', () => {
  it('stacks images vertically with no seam at gap 0', () => {
    const plan = createConcatOutputPlan([square, square, square], 'vertical', 0, 2000)
    expect(plan.width).toBe(1000)
    expect(plan.height).toBe(3000)
    expect(plan.offsets).toEqual([0, 1000, 2000])
    expect(plan.frames.map((frame) => frame.y)).toEqual([0, 1000, 2000])
  })

  it('arranges images left to right for the horizontal direction', () => {
    const plan = createConcatOutputPlan([wide, wide], 'horizontal', 0, 2000)
    expect(plan.width).toBe(3200)
    expect(plan.height).toBe(900)
    expect(plan.offsets).toEqual([0, 1600])
    expect(plan.frames.map((frame) => frame.x)).toEqual([0, 1600])
  })

  it('adds visible white space for positive gaps', () => {
    const plan = createConcatOutputPlan([square, square], 'vertical', 80, 2000)
    expect(plan.offsets).toEqual([0, 1080])
    expect(plan.height).toBe(2080)
  })

  it('overlaps images for negative gaps and keeps the canvas starting at zero', () => {
    const plan = createConcatOutputPlan([square, square, square], 'vertical', -400, 2000)
    expect(plan.offsets).toEqual([0, 600, 1200])
    expect(plan.height).toBe(2200)
  })

  it('shifts the canvas origin when gaps push later images past the first edge', () => {
    const plan = createConcatOutputPlan([square, square], 'vertical', -1200, 2000)
    expect(plan.offsets[0]).toBe(200)
    expect(plan.offsets[1]).toBe(0)
    expect(plan.height).toBe(1200)
  })

  it('caps the largest cross-axis side with one uniform scale', () => {
    const plan = createConcatOutputPlan([wide, tall], 'vertical', 0, 1000)
    expect(plan.scale).toBeCloseTo(1000 / 1600)
    expect(plan.width).toBe(1000)
    expect(plan.height).toBe(Math.round(900 * (1000 / 1600)) + Math.round(1600 * (1000 / 1600)))
  })

  it('centers narrower images on the cross axis', () => {
    const plan = createConcatOutputPlan([wide, square], 'vertical', 0, 2000)
    expect(plan.frames[1].x).toBe(Math.round((1600 - 1000) / 2))
  })

  it('rejects fewer than two images', () => {
    expect(() => createConcatOutputPlan([square], 'vertical', 0, 2000)).toThrow(/至少导入 2 张/)
    expect(() => createConcatOutputPlan([], 'vertical', 0, 2000)).toThrow(/2–60 张/)
  })

  it('rejects oversized batches with an actionable suggestion', () => {
    const sizes = Array.from({ length: CONCAT_MAX_FILES + 1 }, () => square)
    expect(() => createConcatOutputPlan(sizes, 'vertical', 0, 2000)).toThrow(/2–60 张/)
    const many = Array.from({ length: CONCAT_MAX_FILES }, () => ({ width: 2000, height: 1500 }))
    expect(() => createConcatOutputPlan(many, 'vertical', 0, 4000)).toThrow(/超过安全上限.*分成两批/)
    expect(2000 * 1500 * CONCAT_MAX_FILES).toBeGreaterThan(CONCAT_MAX_PIXELS)
  })

  it('treats a gap larger than an image as reversed spacing, not a failure', () => {
    const plan = createConcatOutputPlan([square, square], 'vertical', -1600, 2000)
    expect(plan.offsets).toEqual([600, 0])
    expect(plan.height).toBe(1600)
  })

  it('keeps source rects in native pixels for horizontal strips', () => {
    // The horizontal painter once swapped the frame axes, so a landscape
    // image's source rect read (height × width) and the browser clipped the
    // overhang — the exported wall had squished images, a cut bottom and
    // white space. Source rects must always be native pixel dimensions.
    const plan = createConcatOutputPlan([wide, tall], 'horizontal', 0, 2000)
    expect(plan.frames[0]).toMatchObject({ sx: 0, sy: 0, sw: wide.width, sh: wide.height })
    expect(plan.frames[1]).toMatchObject({ sx: 0, sy: 0, sw: tall.width, sh: tall.height })
    expect(plan.frames[0].w).toBe(wide.width)
    expect(plan.frames[0].h).toBe(wide.height)
    expect(plan.frames[0].x).toBe(0)
    expect(plan.frames[0].y).toBe(Math.round((1600 - wide.height) / 2))
  })
})

describe('createConcatOutputPlan uniform mode', () => {
  const mixed = [wide, square, tall] // cross 1600/1000/900, ratios 900/1600, 1, 1600/900
  const medianRatio = 1 // sorted ratios: 0.5625, 1, 1.7778

  it('gives every image an identical cell sized by the cap and median ratio', () => {
    const plan = createConcatOutputPlan(mixed, 'vertical', 0, 1200, { uniform: true, fit: 'contain' })
    expect(plan.cross).toBe(1200)
    expect(plan.height).toBe(3 * 1200 * medianRatio)
    expect(plan.offsets).toEqual([0, 1200, 2400])
  })

  it('letterboxes images that do not match the cell ratio, centered', () => {
    const plan = createConcatOutputPlan(mixed, 'vertical', 0, 1200, { uniform: true, fit: 'contain' })
    // wide: 1600×900 → contain in 1200×1200 cell → 1200×675, vertical center.
    expect(plan.frames[0].w).toBe(1200)
    expect(plan.frames[0].h).toBe(675)
    expect(plan.frames[0].y).toBe(Math.round((1200 - 675) / 2))
    expect(plan.frames[0].sx).toBe(0)
    // tall: 900×1600 → contain → 675×1200, horizontal center.
    expect(plan.frames[2].w).toBe(675)
    expect(plan.frames[2].x).toBe(Math.round((1200 - 675) / 2))
  })

  it('crops to fill the cell in cover mode without resizing the canvas', () => {
    const plan = createConcatOutputPlan(mixed, 'vertical', 0, 1200, { uniform: true, fit: 'cover' })
    expect(plan.cross).toBe(1200)
    expect(plan.height).toBe(3600)
    expect(plan.frames.every((frame) => frame.w === 1200 && frame.h === 1200)).toBe(true)
    // wide image is cropped from the sides: source rect narrower than the image.
    expect(plan.frames[0].sw).toBeLessThan(wide.width)
    expect(plan.frames[0].sx).toBeGreaterThan(0)
    expect(plan.frames[0].sh).toBe(wide.height)
    // tall image is cropped top and bottom.
    expect(plan.frames[2].sh).toBeLessThan(tall.height)
    expect(plan.frames[2].sy).toBeGreaterThan(0)
    expect(plan.frames[2].sw).toBe(tall.width)
  })

  it('applies the signed gap between uniform cells', () => {
    const spaced = createConcatOutputPlan(mixed, 'vertical', 40, 1200, { uniform: true })
    expect(spaced.offsets).toEqual([0, 1240, 2480])
    expect(spaced.height).toBe(3680)
    const overlapped = createConcatOutputPlan(mixed, 'vertical', -100, 1200, { uniform: true })
    expect(overlapped.offsets).toEqual([0, 1100, 2200])
    expect(overlapped.height).toBe(3400)
  })

  it('caps the uniform cell by the requested limit even for small batches', () => {
    const plan = createConcatOutputPlan([square, square], 'vertical', 0, 600, { uniform: true })
    expect(plan.cross).toBe(600)
    expect(plan.height).toBe(1200)
    expect(plan.frames.every((frame) => frame.w === 600 && frame.h === 600)).toBe(true)
  })

  it('fills horizontal uniform cells without distorting or clipping', () => {
    const plan = createConcatOutputPlan(mixed, 'horizontal', 0, 1200, { uniform: true, fit: 'cover' })
    // cross = height: max natural height is 1600 (tall), capped to 1200.
    // median width/height ratio = 1 → cellMain = 1200.
    expect(plan.cross).toBe(1200)
    expect(plan.width).toBe(3600)
    expect(plan.height).toBe(1200)
    expect(plan.offsets).toEqual([0, 1200, 2400])
    plan.frames.forEach((frame, index) => {
      expect(frame.w).toBe(1200)
      expect(frame.h).toBe(1200)
      // Source rect never exceeds the native bitmap, whatever the direction.
      expect(frame.sx + frame.sw).toBeLessThanOrEqual(mixed[index].width)
      expect(frame.sy + frame.sh).toBeLessThanOrEqual(mixed[index].height)
    })
    // tall: 900×1600 → cover in 1200×1200 → crop top/bottom.
    expect(plan.frames[2].sy).toBeGreaterThan(0)
    expect(plan.frames[2].sh).toBeLessThan(tall.height)
  })
})

describe('createConcatOutputPlan width mode', () => {
  it('scales every image to the exact requested width, keeping its own ratio', () => {
    const plan = createConcatOutputPlan([wide, tall], 'vertical', 0, 2000, { width: 800 })
    expect(plan.width).toBe(800)
    expect(plan.frames.every((frame) => frame.w === 800)).toBe(true)
    expect(plan.frames[0].h).toBe(450) // 900 × 800/1600
    expect(plan.frames[1].h).toBe(Math.round(1600 * 800 / 900))
    expect(plan.frames[0]).toMatchObject({ sx: 0, sy: 0, sw: wide.width, sh: wide.height })
    expect(plan.height).toBe(450 + Math.round(1600 * 800 / 900))
  })

  it('upscales smaller images to the requested width', () => {
    const small = { width: 100, height: 50 }
    const plan = createConcatOutputPlan([small, small], 'vertical', 0, 2000, { width: 800 })
    expect(plan.frames.every((frame) => frame.w === 800 && frame.h === 400)).toBe(true)
  })

  it('stretches every image to the median ratio when the aspect lock is off', () => {
    const plan = createConcatOutputPlan([wide, tall], 'vertical', 0, 2000, { width: 800, lockAspect: false })
    const medianRatio = (wide.height / wide.width + tall.height / tall.width) / 2
    expect(plan.frames[0].h).toBe(Math.round(800 * medianRatio))
    expect(plan.frames[1].h).toBe(plan.frames[0].h)
    expect(plan.height).toBe(2 * plan.frames[0].h)
  })

  it('centers differing heights on the cross axis in horizontal width mode', () => {
    const plan = createConcatOutputPlan([wide, tall], 'horizontal', 0, 2000, { width: 800 })
    const tallHeight = Math.round(1600 * 800 / 900)
    expect(plan.height).toBe(tallHeight)
    expect(plan.width).toBe(1600)
    expect(plan.frames.map((frame) => frame.x)).toEqual([0, 800])
    expect(plan.frames[0].y).toBe(Math.round((tallHeight - 450) / 2))
    expect(plan.frames[1].y).toBe(0)
  })
})
