import { createRasterProcessPlan, type RasterProcessOptions } from '@/lib/image-processing'

type ProcessRequest = { file: File; options: RasterProcessOptions }
type ProcessResponse = { blob?: Blob; error?: string }

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ProcessRequest>) => void) | null
  postMessage(message: ProcessResponse): void
}

workerScope.onmessage = async ({ data }) => {
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(data.file)
    const plan = createRasterProcessPlan(bitmap.width, bitmap.height, data.options)
    const canvas = new OffscreenCanvas(plan.canvasWidth, plan.canvasHeight)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境不支持后台图片画布。')

    if (data.options.outputType === 'image/jpeg') {
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

    const encode = () => canvas.convertToBlob({ type: data.options.outputType, quality: plan.quality })
    let blob = await encode()
    for (let pass = 1; pass < plan.compressionPasses; pass += 1) {
      const encodedBitmap = await createImageBitmap(blob)
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (data.options.outputType === 'image/jpeg') {
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
