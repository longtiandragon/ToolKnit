export type RasterImageMode = 'compose' | 'convert' | 'resize' | 'crop' | 'rotate' | 'metadata'
export type RasterOutputType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface RasterProcessOptions {
  mode: RasterImageMode
  outputType: RasterOutputType
  quality: number
  compressionPasses: number
  maxWidth: number
  rotation: number
  cropLeft: number
  cropTop: number
  cropWidth: number
  cropHeight: number
}

export interface RasterProcessPlan {
  left: number
  top: number
  sourceWidth: number
  sourceHeight: number
  targetWidth: number
  targetHeight: number
  canvasWidth: number
  canvasHeight: number
  rotation: number
  quality: number
  compressionPasses: number
}

export const MAX_IMAGE_PROCESS_PIXELS = 64_000_000

export function safeCompressionPassLimit(width: number, height: number) {
  if (!width || !height) return 50
  const pixels = Math.max(1, width * height)
  return Math.max(1, Math.min(50, Math.floor(160_000_000 / pixels)))
}

export function createRasterProcessPlan(width: number, height: number, options: RasterProcessOptions): RasterProcessPlan {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('图片尺寸无效，无法处理。')
  }

  const cropping = options.mode === 'crop'
  const left = cropping ? Math.round(width * options.cropLeft / 100) : 0
  const top = cropping ? Math.round(height * options.cropTop / 100) : 0
  const right = cropping ? Math.round(width * (options.cropLeft + options.cropWidth) / 100) : width
  const bottom = cropping ? Math.round(height * (options.cropTop + options.cropHeight) / 100) : height
  const sourceWidth = right - left
  const sourceHeight = bottom - top
  if (left < 0 || top < 0 || sourceWidth < 1 || sourceHeight < 1 || left + sourceWidth > width || top + sourceHeight > height) {
    throw new Error('裁剪区域超出图片，请调整起点或宽高。')
  }

  const requestedWidth = Math.max(100, Math.trunc(Number(options.maxWidth) || 100))
  const targetWidth = options.mode === 'resize' ? Math.min(sourceWidth, requestedWidth) : sourceWidth
  const targetHeight = Math.max(1, Math.round(sourceHeight * targetWidth / sourceWidth))
  const rotation = options.mode === 'rotate' ? ((Math.trunc(options.rotation) % 360) + 360) % 360 : 0
  const sideways = rotation % 180 !== 0
  const canvasWidth = sideways ? targetHeight : targetWidth
  const canvasHeight = sideways ? targetWidth : targetHeight
  if (canvasWidth * canvasHeight > MAX_IMAGE_PROCESS_PIXELS) {
    throw new Error(`图片处理后达到 ${canvasWidth} × ${canvasHeight} 像素，超过安全上限；请先用“压缩缩放”降低宽度。`)
  }

  const requestedPasses = Math.max(1, Math.trunc(Number(options.compressionPasses) || 1))
  const compressionPasses = options.outputType === 'image/png'
    ? 1
    : Math.min(requestedPasses, safeCompressionPassLimit(canvasWidth, canvasHeight))

  return {
    left,
    top,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    canvasWidth,
    canvasHeight,
    rotation,
    quality: Math.max(0.2, Math.min(1, Number(options.quality) || 1)),
    compressionPasses,
  }
}
