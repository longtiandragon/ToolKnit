import type { PdfAttachmentMime } from './pdf-attachments'

export type PdfTaskOperation = 'merge' | 'split' | 'compare' | 'rotate' | 'extract' | 'reorder' | 'watermark' | 'page-number' | 'crop' | 'text' | 'attachments' | 'bookmarks' | 'pdf-to-image' | 'compress' | 'redact' | 'ocr'

export interface PdfTaskInput { name: string; data: ArrayBuffer }

export interface PdfTaskRequest {
  operation: PdfTaskOperation
  files: PdfTaskInput[]
  outputName: string
  pageRange: string
  rotation: number
  pageNumberStart: number
  pageNumberPosition: 'bottom-center' | 'bottom-right'
  watermark?: { data: ArrayBuffer; opacity: number }
  /** 仅 pdf-to-image：输出图片格式，默认 png。 */
  imageFormat?: 'png' | 'jpeg' | 'webp'
  /** 仅 pdf-to-image：渲染分辨率，72–300 DPI，默认 150。 */
  imageDpi?: number
  /** 仅 pdf-to-image：JPG/WebP 压缩质量 1–100，默认 90；PNG 忽略。 */
  imageQuality?: number
  /** 仅 redact：逗号、换行分隔的敏感文本。匹配页面会被永久栅格化并覆盖。 */
  redactTerms?: string
  /** 仅 crop：相对每页的百分比裁剪框。 */
  cropLeft?: number
  cropTop?: number
  cropWidth?: number
  cropHeight?: number
}

export interface PdfTaskOutput {
  name: string
  data: ArrayBuffer
  mime: 'application/pdf' | 'text/plain;charset=utf-8' | PdfAttachmentMime
  pageWidth?: number
  pageHeight?: number
  pageIndex?: number
  pageCount?: number
}

interface PendingTask {
  resolve: () => void
  reject: (error: Error) => void
  onOutput: (output: PdfTaskOutput) => Promise<void> | void
  onProgress?: (progress: number, detail: string) => void
  lastProgress: number
  lastProgressAt: number
}

let worker: Worker | undefined
let nextTaskId = 0
const pending = new Map<string, PendingTask>()
export const PDF_TASK_CANCELLED_MESSAGE = 'PDF 任务已停止。'

function errorFrom(value: unknown) {
  return value instanceof Error ? value : new Error(typeof value === 'string' ? value : 'PDF Worker 执行失败。')
}

function resetWorker(reason?: Error) {
  worker?.terminate()
  worker = undefined
  for (const task of pending.values()) task.reject(reason ?? new Error('PDF Worker 已停止。'))
  pending.clear()
}

/** Stops the one active PDF task by terminating its isolated worker. This is
 * deliberately stronger than a cooperative flag: pdf-lib/pdf.js can spend a
 * long time inside a page operation, while worker termination releases that
 * memory immediately and keeps the desktop UI responsive. Outputs already
 * acknowledged by the caller are intentionally left in place. */
export function cancelPdfTask() {
  if (!pending.size) return false
  resetWorker(new Error(PDF_TASK_CANCELLED_MESSAGE))
  return true
}

function getWorker() {
  if (worker) return worker
  const instance = new Worker(new URL('../workers/pdf-tools.worker.ts', import.meta.url), { type: 'module' })
  worker = instance
  instance.addEventListener('error', (event) => {
    resetWorker(new Error(event.message || 'PDF Worker 未能启动。'))
  })
  instance.addEventListener('message', (event: MessageEvent<{
    type: 'progress' | 'output' | 'done' | 'error'
    taskId: string
    outputId?: string
    progress?: number
    detail?: string
    output?: PdfTaskOutput
    error?: string
  }>) => {
    const payload = event.data
    const task = pending.get(payload.taskId)
    if (!task) return
    if (payload.type === 'progress') {
      const progress = Math.max(1, Math.min(99, Math.round(payload.progress ?? 1)))
      const now = performance.now()
      if (progress >= task.lastProgress + 2 || now - task.lastProgressAt >= 420) {
        task.lastProgress = progress
        task.lastProgressAt = now
        task.onProgress?.(progress, payload.detail || '正在处理 PDF…')
      }
      return
    }
    if (payload.type === 'output' && payload.output && payload.outputId) {
      Promise.resolve(task.onOutput(payload.output))
        .then(() => {
          // A cancellation can terminate this worker while the native save is
          // finishing. Never acknowledge that old output to a replacement
          // worker, and do not resurrect a cancelled task.
          if (worker === instance && pending.has(payload.taskId)) instance.postMessage({ type: 'ack', taskId: payload.taskId, outputId: payload.outputId })
        })
        .catch((error) => { if (pending.has(payload.taskId)) resetWorker(errorFrom(error)) })
      return
    }
    pending.delete(payload.taskId)
    if (payload.type === 'done') task.resolve()
    else task.reject(new Error(payload.error || 'PDF Worker 执行失败。'))
  })
  return instance
}

/** Runs one PDF task in a lazily-created worker. Input buffers are transferred,
 * and every output waits for the caller's save acknowledgement before the next
 * one is produced, keeping split-PDF memory usage bounded. */
export function runPdfTask(request: PdfTaskRequest, handlers: {
  onOutput: (output: PdfTaskOutput) => Promise<void> | void
  onProgress?: (progress: number, detail: string) => void
}) {
  if (pending.size) return Promise.reject(new Error('已有一个 PDF 任务正在执行。'))
  const taskId = `pdf-${++nextTaskId}-${Date.now()}`
  const instance = getWorker()
  return new Promise<void>((resolve, reject) => {
    pending.set(taskId, { resolve, reject, onOutput: handlers.onOutput, onProgress: handlers.onProgress, lastProgress: 0, lastProgressAt: 0 })
    const transfer = request.files.map((file) => file.data)
    if (request.watermark) transfer.push(request.watermark.data)
    instance.postMessage({ type: 'run', taskId, request }, transfer)
  })
}
