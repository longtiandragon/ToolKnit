import { createConcatOutputPlan, type ConcatDirection } from '@/lib/image-concat'

type ConcatRequest = {
  files: File[]
  direction: ConcatDirection
  gap: number
  maxCross: number
  uniform: boolean
  fit: 'contain' | 'cover'
  width?: number
  lockAspect?: boolean
}
type ConcatProgress = { kind: 'progress'; progress: number; detail: string }
type ConcatResult = { kind: 'result'; blob: Blob; width: number; height: number; scales: number[] }
type ConcatError = { kind: 'error'; error: string }

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ConcatRequest>) => void) | null
  postMessage(message: ConcatProgress | ConcatResult | ConcatError): void
}

function progress(value: number, detail: string) {
  workerScope.postMessage({ kind: 'progress', progress: value, detail })
}

workerScope.onmessage = async ({ data }) => {
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof OffscreenCanvas.prototype.convertToBlob !== 'function') {
      throw new Error('当前环境不支持离屏画布，无法拼成长图。请使用 Knitspace 桌面版或新版 Chrome/Edge。')
    }
    // Pass 1 measures every image and releases it immediately; pass 2 decodes
    // again to draw. Doubling the decode keeps memory bounded to one bitmap
    // plus the output canvas, no matter how many photos are staged.
    const sizes: { width: number; height: number }[] = []
    for (let index = 0; index < data.files.length; index += 1) {
      const bitmap = await createImageBitmap(data.files[index])
      sizes.push({ width: bitmap.width, height: bitmap.height })
      bitmap.close()
      progress(2 + Math.round((index + 1) / data.files.length * 8), `正在读取第 ${index + 1}/${data.files.length} 张图片尺寸…`)
    }
    const plan = createConcatOutputPlan(sizes, data.direction, data.gap, data.maxCross, { uniform: data.uniform, fit: data.fit, width: data.width, lockAspect: data.lockAspect })
    const canvas = new OffscreenCanvas(plan.width, plan.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法建立拼接画布。')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    // Unified width can upscale smaller images; ask the browser for its best
    // resampling instead of the default bilinear pass.
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    const scales: number[] = []
    for (let index = 0; index < data.files.length; index += 1) {
      const bitmap = await createImageBitmap(data.files[index])
      const frame = plan.frames[index]
      // The plan hands out complete canvas-space draw instructions, so the
      // painter has no direction logic left to get wrong.
      context.drawImage(bitmap, frame.sx, frame.sy, frame.sw, frame.sh, frame.x, frame.y, frame.w, frame.h)
      scales.push(frame.w / bitmap.width)
      bitmap.close()
      progress(12 + Math.round((index + 1) / data.files.length * 82), `正在拼接第 ${index + 1}/${data.files.length} 张…`)
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    progress(100, '长图已生成')
    workerScope.postMessage({ kind: 'result', blob, width: plan.width, height: plan.height, scales })
  } catch (error) {
    workerScope.postMessage({ kind: 'error', error: error instanceof Error ? error.message : '拼成长图失败。' })
  }
}
