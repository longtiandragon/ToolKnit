import { describe, expect, it } from 'vitest'
import { createRasterProcessPlan, MAX_IMAGE_PROCESS_PIXELS, safeCompressionPassLimit, type RasterProcessOptions } from './image-processing'

const defaults: RasterProcessOptions = {
  mode: 'convert',
  outputType: 'image/jpeg',
  quality: 0.82,
  compressionPasses: 8,
  maxWidth: 1920,
  rotation: 0,
  cropLeft: 0,
  cropTop: 0,
  cropWidth: 100,
  cropHeight: 100,
}

describe('raster image processing plan', () => {
  it('calculates crop coordinates without changing the selected size', () => {
    const plan = createRasterProcessPlan(4000, 3000, {
      ...defaults,
      mode: 'crop',
      cropLeft: 10,
      cropTop: 20,
      cropWidth: 60,
      cropHeight: 50,
    })

    expect(plan).toMatchObject({ left: 400, top: 600, sourceWidth: 2400, sourceHeight: 1500, canvasWidth: 2400, canvasHeight: 1500 })
  })

  it('preserves aspect ratio when resizing and swaps the rotated canvas', () => {
    expect(createRasterProcessPlan(4000, 3000, { ...defaults, mode: 'resize', maxWidth: 1600 })).toMatchObject({ targetWidth: 1600, targetHeight: 1200 })
    expect(createRasterProcessPlan(4000, 3000, { ...defaults, mode: 'rotate', rotation: 90 })).toMatchObject({ canvasWidth: 3000, canvasHeight: 4000, rotation: 90 })
  })

  it('keeps the original pixels when clearing metadata', () => {
    expect(createRasterProcessPlan(1600, 900, { ...defaults, mode: 'metadata' })).toMatchObject({
      left: 0,
      top: 0,
      sourceWidth: 1600,
      sourceHeight: 900,
      targetWidth: 1600,
      targetHeight: 900,
      canvasWidth: 1600,
      canvasHeight: 900,
      rotation: 0,
    })
  })

  it('bounds repeated encoding by image area and keeps PNG single-pass', () => {
    expect(safeCompressionPassLimit(4000, 4000)).toBe(10)
    expect(createRasterProcessPlan(4000, 4000, { ...defaults, compressionPasses: 50 }).compressionPasses).toBe(10)
    expect(createRasterProcessPlan(4000, 4000, { ...defaults, outputType: 'image/png', compressionPasses: 50 }).compressionPasses).toBe(1)
  })

  it('rejects canvas sizes that could exhaust desktop memory', () => {
    const edge = Math.floor(Math.sqrt(MAX_IMAGE_PROCESS_PIXELS))
    expect(() => createRasterProcessPlan(edge + 1, edge + 1, defaults)).toThrow('超过安全上限')
  })
})
