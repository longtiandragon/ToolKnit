import { createStitchOutputPlan, findVerticalOverlap, STITCH_MAX_FILES } from '@/lib/image-stitch'

type StitchRequest = {
  files: File[]
  overlapMode: 'auto' | 'manual'
  manualOverlapPercent: number
}
type StitchFrame = { bitmap: ImageBitmap; width: number; height: number; sample: Uint8Array }
type StitchProgress = { kind: 'progress'; progress: number; detail: string }
type StitchResult = { kind: 'result'; blob: Blob; width: number; height: number; overlaps: number[]; scores: number[]; warnings: string[] }
type StitchError = { kind: 'error'; error: string }

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<StitchRequest>) => void) | null
  postMessage(message: StitchProgress | StitchResult | StitchError): void
}

function progress(value: number, detail: string) {
  workerScope.postMessage({ kind: 'progress', progress: value, detail })
}

function grayscaleSample(bitmap: ImageBitmap, width = 128) {
  const height = Math.max(24, Math.min(320, Math.round(bitmap.height * width / bitmap.width)))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前环境无法建立截图采样画布。')
  context.drawImage(bitmap, 0, 0, width, height)
  const rgba = context.getImageData(0, 0, width, height).data
  const gray = new Uint8Array(width * height)
  for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
    gray[pixel] = Math.round(rgba[index] * .299 + rgba[index + 1] * .587 + rgba[index + 2] * .114)
  }
  return gray
}

workerScope.onmessage = async ({ data }) => {
  const frames: StitchFrame[] = []
  try {
    if (data.files.length < 2 || data.files.length > STITCH_MAX_FILES) throw new Error(`请选择 2–${STITCH_MAX_FILES} 张连续截图。`)
    progress(4, '正在读取截图…')
    for (let index = 0; index < data.files.length; index += 1) {
      const bitmap = await createImageBitmap(data.files[index])
      const sample = grayscaleSample(bitmap)
      frames.push({ bitmap, width: bitmap.width, height: bitmap.height, sample })
      progress(5 + Math.round((index + 1) / data.files.length * 25), `已读取 ${index + 1} / ${data.files.length} 张`)
    }
    const targetWidth = Math.min(...frames.map((frame) => frame.width))
    if (targetWidth < 320) throw new Error('截图宽度过小，无法可靠识别滚动重叠。')
    if (frames.some((frame) => Math.abs(frame.width / targetWidth - 1) > .2)) throw new Error('截图宽度差异超过 20%，请使用同一窗口和缩放比例重新截图。')
    const scaledHeights = frames.map((frame) => Math.max(1, Math.round(frame.height * targetWidth / frame.width)))
    const overlaps: number[] = []
    const scores: number[] = []
    const warnings: string[] = []
    for (let index = 1; index < frames.length; index += 1) {
      if (data.overlapMode === 'manual') {
        overlaps.push(Math.round(scaledHeights[index] * Math.max(0, Math.min(70, data.manualOverlapPercent)) / 100))
        scores.push(0)
      } else {
        const result = findVerticalOverlap(frames[index - 1].sample, frames[index].sample, 128)
        scores.push(result.score)
        if (result.confidence === 'high') overlaps.push(Math.round(result.rows / (frames[index].sample.length / 128) * scaledHeights[index]))
        else {
          overlaps.push(0)
          warnings.push(`第 ${index}、${index + 1} 张没有可靠重叠，已完整保留两张内容。`)
        }
      }
      progress(31 + Math.round(index / (frames.length - 1) * 30), `正在匹配第 ${index} / ${frames.length - 1} 处重叠`)
    }
    const plan = createStitchOutputPlan(targetWidth, scaledHeights, overlaps)
    const canvas = new OffscreenCanvas(plan.width, plan.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境无法建立滚动长图画布。')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    frames.forEach((frame, index) => {
      const overlap = index ? overlaps[index - 1] : 0
      const sourceOverlap = Math.round(overlap * frame.width / targetWidth)
      const drawHeight = scaledHeights[index] - overlap
      context.drawImage(frame.bitmap, 0, sourceOverlap, frame.width, frame.height - sourceOverlap, 0, plan.offsets[index], targetWidth, drawHeight)
      progress(63 + Math.round((index + 1) / frames.length * 25), `正在拼接 ${index + 1} / ${frames.length} 张`)
    })
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    progress(100, '滚动长图已生成')
    workerScope.postMessage({ kind: 'result', blob, width: plan.width, height: plan.height, overlaps, scores, warnings })
  } catch (error) {
    workerScope.postMessage({ kind: 'error', error: error instanceof Error ? error.message : '滚动截图拼接失败。' })
  } finally {
    frames.forEach((frame) => frame.bitmap.close())
  }
}
