import { createRasterProcessPlan, type RasterProcessOptions } from '@/lib/image-processing'
import {
  buildEnhanceCurve,
  computeInverseHomography,
  estimateDeskewSize,
  fullFrameQuad,
  MAX_DESKEW_PIXELS,
  orderQuadCorners,
  validateScanQuad,
} from '@/lib/scan-enhance'

type ProcessRequest = { file: File; options: RasterProcessOptions }
type ProcessResponse = { blob?: Blob; error?: string }

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ProcessRequest>) => void) | null
  postMessage(message: ProcessResponse): void
}

/** Backward-warps the selected quad onto an upright rectangle and applies the
 * tone curve in the same pass. Returns a bitmap so the caller can hand it to
 * the ordinary encode path unchanged. */
async function warpDocument(bitmap: ImageBitmap, options: RasterProcessOptions) {
  // Reading a 48 MP photo as RGBA would allocate ~192 MB, so bound the source
  // and carry the same factor over to the corner coordinates.
  const sourcePixels = bitmap.width * bitmap.height
  const scale = sourcePixels > MAX_DESKEW_PIXELS ? Math.sqrt(MAX_DESKEW_PIXELS / sourcePixels) : 1
  const sourceWidth = Math.max(1, Math.round(bitmap.width * scale))
  const sourceHeight = Math.max(1, Math.round(bitmap.height * scale))

  const sourceCanvas = new OffscreenCanvas(sourceWidth, sourceHeight)
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
  if (!sourceContext) throw new Error('当前环境不支持后台图片画布。')
  sourceContext.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight)
  const source = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight)

  const picked = options.quad ?? fullFrameQuad(bitmap.width, bitmap.height)
  const quad = orderQuadCorners(picked.map(point => ({ x: point.x * scale, y: point.y * scale })))
  validateScanQuad(quad, sourceWidth, sourceHeight)

  const { width: targetWidth, height: targetHeight } = estimateDeskewSize(quad)
  const homography = computeInverseHomography(quad, targetWidth, targetHeight)
  const curve = buildEnhanceCurve(options.enhance ?? { mode: 'none', strength: 0 })

  const output = new ImageData(targetWidth, targetHeight)
  const src = source.data
  const dst = output.data
  const maxX = sourceWidth - 1
  const maxY = sourceHeight - 1
  // The per-pixel mapping is inlined rather than routed through
  // mapThroughHomography: allocating a point object per destination pixel
  // dominates the runtime at these sizes.
  const [a, b, c, d, e, f, g, h, i] = homography

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const denominator = g * x + h * y + i
      const sx = denominator ? (a * x + b * y + c) / denominator : 0
      const sy = denominator ? (d * x + e * y + f) / denominator : 0

      const clampedX = sx < 0 ? 0 : sx > maxX ? maxX : sx
      const clampedY = sy < 0 ? 0 : sy > maxY ? maxY : sy
      const x0 = Math.floor(clampedX)
      const y0 = Math.floor(clampedY)
      const x1 = x0 < maxX ? x0 + 1 : x0
      const y1 = y0 < maxY ? y0 + 1 : y0
      const fx = clampedX - x0
      const fy = clampedY - y0

      const topLeft = (y0 * sourceWidth + x0) * 4
      const topRight = (y0 * sourceWidth + x1) * 4
      const bottomLeft = (y1 * sourceWidth + x0) * 4
      const bottomRight = (y1 * sourceWidth + x1) * 4
      const target = (y * targetWidth + x) * 4

      for (let channel = 0; channel < 3; channel += 1) {
        const top = src[topLeft + channel] + (src[topRight + channel] - src[topLeft + channel]) * fx
        const bottom = src[bottomLeft + channel] + (src[bottomRight + channel] - src[bottomLeft + channel]) * fx
        dst[target + channel] = curve[Math.round(top + (bottom - top) * fy)]
      }
      // Scans are opaque; forcing alpha avoids a translucent fringe when the
      // source image carries an alpha channel.
      dst[target + 3] = 255
    }
  }

  return createImageBitmap(output)
}

workerScope.onmessage = async ({ data }) => {
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(data.file)

    let options = data.options
    if (options.mode === 'deskew') {
      const warped = await warpDocument(bitmap, options)
      bitmap.close()
      bitmap = warped
      // Geometry is already applied; the remaining pass only downscales and
      // encodes, so neutralise the crop/rotate inputs.
      options = { ...options, mode: 'resize', rotation: 0, cropLeft: 0, cropTop: 0, cropWidth: 100, cropHeight: 100 }
    }

    const plan = createRasterProcessPlan(bitmap.width, bitmap.height, options)
    const canvas = new OffscreenCanvas(plan.canvasWidth, plan.canvasHeight)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境不支持后台图片画布。')

    if (options.outputType === 'image/jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate(plan.rotation * Math.PI / 180)
    context.drawImage(
      bitmap,
      plan.left,
      plan.top,
      plan.sourceWidth,
      plan.sourceHeight,
      -plan.targetWidth / 2,
      -plan.targetHeight / 2,
      plan.targetWidth,
      plan.targetHeight,
    )
    bitmap.close()
    bitmap = undefined

    const encode = () => canvas.convertToBlob({ type: options.outputType, quality: plan.quality })
    let blob = await encode()
    for (let pass = 1; pass < plan.compressionPasses; pass += 1) {
      const encodedBitmap = await createImageBitmap(blob)
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (options.outputType === 'image/jpeg') {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
      }
      context.drawImage(encodedBitmap, 0, 0, canvas.width, canvas.height)
      encodedBitmap.close()
      blob = await encode()
    }
    workerScope.postMessage({ blob })
  } catch (error) {
    bitmap?.close()
    workerScope.postMessage({ error: error instanceof Error ? error.message : '后台图片处理失败。' })
  }
}
